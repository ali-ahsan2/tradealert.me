// One way to ask for a plan change from anywhere: dispatch an event and the
// UpgradeSheet (mounted once in the shell) opens in place, framed on the
// reason. No screen navigates to /pricing for a prompt any more; the plans
// page stays for side-by-side comparison.
//
//   openUpgrade("alerts")                        // hit the alert quota
//   openUpgrade("picks", { symbol: "LEU" })      // pin limit, with the name
//   openUpgrade("industries")                    // wants another industry
//   openUpgrade("names")                         // list clamped by the plan
//   openUpgrade("beyond")                        // misses beyond the plan
//   openUpgrade("channels", { channel: "push" }) // a channel not in the plan

export const UPGRADE_EVENT = "upgrade:open";

export const REASONS = ["alerts", "picks", "industries", "names", "beyond", "channels", "general"];

export function openUpgrade(reason = "general", context = {}) {
  const detail = { reason: REASONS.includes(reason) ? reason : "general", ...context };
  window.dispatchEvent(new CustomEvent(UPGRADE_EVENT, { detail }));
}
