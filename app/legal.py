"""The legal posture in one place (DESIGN_V6 §6). The constants mirror
frontend/src/lib/legal.js word for word; the two files must match.

TERMS_VERSION is what a person accepts. Bump it when the Terms change in
substance and every account is asked once more (the /welcome gate compares
/api/me's accepted_terms_version with terms_version_current).
"""

TERMS_VERSION = "2026-10-11"
TERMS_EFFECTIVE = "11 October 2026"

# One line, under primary actions and in footers.
FINE_PRINT_SHORT = "Information and alerts, not advice. Your decisions are your own."

# The paragraph, on legal pages, pricing and at the end of every email.
FINE_PRINT_LONG = (
    "tradealert.me is an information and alerting service. It is not a registered "
    "investment adviser or broker-dealer, owes you no fiduciary duty, does not know "
    "your situation and gives no personalised advice; nothing it sends or shows is a "
    "recommendation to buy, sell or hold any security. Scores rank names on a fixed "
    "scale; alerts report that a fact changed. Past movement after an alert is not a "
    "forecast of future movement. You are responsible for your own decisions and "
    "their results; consider a licensed professional before you act."
)

# The sentence a person ticks at sign-up and once per terms version.
CONSENT_LABEL = (
    "I understand tradealert.me sends information and alerts, not financial advice, "
    "and that my decisions and their results are my own."
)

# Plain words for each alert trigger, for email subjects and push titles
# (DESIGN_V6 §7: plain word first). Mirrors TRIGGER_PLAIN in lib/glossary.js.
TRIGGER_PLAIN = {
    "borrow_fee_2x": "Borrow fee doubles",
    "si_cross": "Short interest crosses a line",
    "volume_3x": "Unusual volume",
    "catalyst_dated": "Catalyst coming up",
    "s3_424b": "Dilution filing",
    "band_change": "Score changes band",
    "insider_buying": "Insiders buying",
    "social_surge": "Social chatter spikes",
    "contract_award": "Contract award",
}


def trigger_plain(key):
    """The plain phrase for a trigger key; an unknown key reads as words."""
    return TRIGGER_PLAIN.get(key) or (key or "").replace("_", " ")


def email_footer(unsubscribe_url=None, settings_url=None):
    """What every email ends with: a rule, the long fine print, and the
    links that let the reader stop or change delivery. Account emails
    (verification, password reset) pass no unsubscribe_url: they are sent
    as needed and cannot be opted out of while the account exists."""
    lines = ["", "—", FINE_PRINT_LONG]
    links = []
    if unsubscribe_url:
        links.append(f"Stop these emails: {unsubscribe_url}")
    if settings_url:
        links.append(f"Change how you reach me: {settings_url}")
    if links:
        lines.append("")
        lines.extend(links)
    return "\n" + "\n".join(lines)
