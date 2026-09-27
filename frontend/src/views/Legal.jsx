import { navigate } from "../main.jsx";

function LawRow({ h, children }) {
  return (
    <section className="scoreblock">
      <h2 style={{ fontSize: "var(--fs-md)" }}>{h}</h2>
      {children}
    </section>
  );
}

export default function Legal({ page }) {
  const title =
    page === "terms" ? "Terms of use" : page === "privacy" ? "Privacy policy" : "Disclaimer";
  return (
    <div className="wrap">
      <div className="pagehead">
        <h1>{title}</h1>
        <div className="meta">tradealert.me · effective September 2026</div>
      </div>
      <div className="report">
        <div className="report-main">
          <LawRow h="What this site is">
            <p className="st">
              tradealert.me publishes machine-scored research notes on small-cap
              tickers. Scores, bands, and theses are produced by automated
              filters from public filings and quote data. Nothing on this site
              is a recommendation to buy or sell any security.
            </p>
          </LawRow>
          <LawRow h={page === "privacy" ? "What we collect" : "Your use"}>
            <p className="st">
              {page === "privacy"
                ? "An email address and, for paying subscribers, the billing details Stripe processes on our behalf. We do not sell or share personal data with third parties for their own purposes."
                : "You may view the public board without an account. Accounts let you follow industries, keep a watchlist, and arm alerts. Abusive or automated scraping is prohibited."}
            </p>
          </LawRow>
          <LawRow h={page === "disclaimer" ? "No advice" : "No warranties"}>
            <p className="st">
              {page === "disclaimer"
                ? "You are reading claims to double-check, not instructions to act on. Verify every figure against primary sources before making any decision."
                : "The data pipeline is imperfect. Scores can miss inputs, shrink on thin coverage, and reflect stale filings. The service is provided as-is, without warranty of accuracy or fitness for any purpose."}
            </p>
          </LawRow>
          <LawRow h="Contact">
            <p className="st">
              Questions about these terms go to the operator at the address on
              the account page.
            </p>
          </LawRow>
        </div>
      </div>
      <p>
        <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
          Back to the board
        </a>
      </p>
    </div>
  );
}