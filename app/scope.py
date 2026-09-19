"""Shared account/scope helpers. One source of truth for the visible-universe
rule (BUILD_SPEC section 5): a name is visible to a subscriber iff it sits in
their followed industries (top-K by tier) UNION their pinned picks. Board,
stock, and search all build their WHERE from the same helpers so \"not found\"
and \"not visible\" stay structurally the same query result."""

TIER_COLS = (
    "t.key, t.label, t.price_monthly_cents, t.industries_limit, "
    "t.names_shown_limit, t.picks_limit, t.alerts_limit, t.channels"
)


def tier_for_user(conn, user_id):
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT {TIER_COLS} FROM subscriptions s "
            "JOIN tiers t ON t.id = s.tier_id "
            "WHERE s.user_id = %s AND s.status = 'active'",
            (user_id,),
        )
        return cur.fetchone()


def provision_free(conn, user_id):
    """Give every signup the Free tier and default settings if not present."""
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM tiers WHERE key = 'free'")
        tier = cur.fetchone()
        if tier:
            cur.execute(
                "INSERT INTO subscriptions (user_id, tier_id) VALUES (%s, %s) "
                "ON CONFLICT (user_id) DO NOTHING",
                (user_id, tier[0]),
            )
        cur.execute(
            "INSERT INTO user_settings (user_id) VALUES (%s) "
            "ON CONFLICT (user_id) DO NOTHING",
            (user_id,),
        )


def allowed_industry_keys(conn, user_id, industries_limit):
    """Subscription scoping: followed industries (capped at the tier limit)
    when the user follows any; otherwise the tier limit of default industries.
    999 = Investor = everything."""
    with conn.cursor() as cur:
        if user_id is not None:
            cur.execute(
                "SELECT i.key FROM user_industries ui "
                "JOIN industries i ON i.id = ui.industry_id "
                "WHERE ui.user_id = %s ORDER BY ui.followed_at",
                (user_id,),
            )
            followed = [r[0] for r in cur.fetchall()]
        else:
            followed = []
    if followed:
        if industries_limit >= 999:
            return followed, "followed"
        return followed[:max(1, min(industries_limit, len(followed)))], "followed"
    with conn.cursor() as cur:
        cur.execute("SELECT key FROM industries ORDER BY sort_order")
        defaults = [r[0] for r in cur.fetchall()]
    if industries_limit >= 999:
        return defaults, "all"
    return defaults[:max(1, min(industries_limit, len(defaults)))], "default"


def pick_instrument_ids(conn, user_id):
    with conn.cursor() as cur:
        cur.execute("SELECT instrument_id FROM picks WHERE user_id = %s AND active", (user_id,))
        return [r[0] for r in cur.fetchall()]


def user_scope(conn, user_id, industries_limit):
    """Returns (allowed_industry_keys, scope_label, pick_instrument_ids)."""
    keys, scope = allowed_industry_keys(conn, user_id, industries_limit)
    picks = pick_instrument_ids(conn, user_id) if user_id is not None else []
    return keys, scope, picks


def visible_sql_and_params(allowed_keys, pick_ids, alias="i"):
    """WHERE fragment: in allowed industries OR in pinned picks. Returns
    (sql_fragment, params). Both lists may be empty; caller handles."""
    parts, params = [], []
    if allowed_keys:
        parts.append(f"{alias}.industry_id IN (SELECT id FROM industries WHERE key = ANY(%s))")
        params.append(allowed_keys)
    if pick_ids:
        parts.append(f"{alias}.id = ANY(%s)")
        params.append(pick_ids)
    if not parts:
        return "FALSE", params
    return "(" + " OR ".join(parts) + ")", params


def enforce_tier_limits(conn, user_id, tier):
    """Apply a (possibly downgraded) tier to a subscriber's data: deactivate
    pinned picks beyond picks_limit, drop followed industries beyond
    industries_limit, delete alert rules beyond alerts_limit. Idempotent;
    called on upgrade, downgrade, and provisioning."""
    industries_limit = tier[3] if tier else 1
    picks_limit = tier[5] if tier else 1
    alerts_limit = tier[6] if tier else 0
    with conn.cursor() as cur:
        if industries_limit < 999:
            cur.execute(
                "DELETE FROM user_industries ui WHERE ui.user_id = %s AND ui.industry_id IN ("
                "  SELECT industry_id FROM user_industries WHERE user_id = %s "
                "  ORDER BY followed_at OFFSET %s)",
                (user_id, user_id, industries_limit),
            )
        if picks_limit >= 0:
            cur.execute(
                "UPDATE picks SET active = FALSE WHERE user_id = %s AND active AND id IN ("
                "  SELECT id FROM picks WHERE user_id = %s AND active "
                "  ORDER BY sort_order, pinned_at OFFSET %s)",
                (user_id, user_id, picks_limit),
            )
        if alerts_limit is not None:
            cur.execute(
                "DELETE FROM alert_rules WHERE user_id = %s AND id IN ("
                "  SELECT id FROM alert_rules WHERE user_id = %s "
                "  ORDER BY armed_at OFFSET %s)",
                (user_id, user_id, alerts_limit),
            )