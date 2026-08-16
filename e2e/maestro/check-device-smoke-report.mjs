import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

function usage() {
  return [
    "Usage: npm run e2e:device-report:check -- <report-file>",
    "",
    "Checks a completed device smoke report for basic MVP release evidence:",
    "iOS and Android pass rows, final decision checkboxes, automated gate",
    "evidence, platform evidence, and smoke-path evidence notes."
  ].join("\n");
}

function escapedPattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tableValue(report, label) {
  const rowPattern = new RegExp(`\\|\\s*${escapedPattern(label)}\\s*\\|\\s*([^|\\n]*?)\\s*\\|`);
  const match = report.match(rowPattern);
  return match?.[1].trim() ?? null;
}

function hasNonBlankTableValue(report, label) {
  const value = tableValue(report, label);
  return value !== null && value.length > 0;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function reportProblems(report) {
  const problems = [];
  const requiredReleaseFields = [
    "Source commit",
    "Release candidate tag/build",
    "Build profile",
    "App version/build number",
    "Backend URL",
    "Supabase project",
    "Tester(s)",
    "Test date"
  ];
  const requiredFinalChecks = [
    "- [x] iOS pass",
    "- [x] Android pass",
    "- [x] All critical failures resolved or explicitly accepted",
    "- [x] Release owner approved"
  ];
  const requiredGateLabels = [
    "`npm run verify` evidence",
    "`npm run backend:release-env:check -- production` evidence",
    "`npm run mobile:release-env:check -- <preview|production>` evidence",
    "`npm run security:audit` evidence or explicit not-run reason",
    "Device smoke data seed evidence"
  ];
  const requiredSmokeEvidenceLabels = [
    "Default Simplified Chinese UI",
    "Language switching and persisted language preference",
    "Supabase sign-up/sign-in and persisted session",
    "Profile sync with name, student ID, and avatar URL",
    "Team navigation and team home aggregates",
    "Inbox load and unread state",
    "Native push token registration or manual fallback",
    "Team announcement notification",
    "Event signup states: going / maybe / not going with reason",
    "Signup read-only after deadline or completion",
    "Captain/admin match live logging: goal, card, substitution",
    "Match log delete confirmation",
    "Member read-only live board access",
    "Attendance completion with missing members marked absent",
    "Completed event edit/delete blocked",
    "Attendance correction coin clawback and negative-balance allowance",
    "Attendance board filters and rows",
    "Coin balance, ledger, reward rule editing, and manual adjustment",
    "Store item redemption and finite-stock deduction",
    "Fulfillment notification",
    "Refund and finite-stock restoration",
    "Notification deep-link behavior"
  ];

  for (const field of requiredReleaseFields) {
    if (!hasNonBlankTableValue(report, field)) {
      problems.push(`Release candidate field is missing: ${field}`);
    }
  }
  const backendUrl = tableValue(report, "Backend URL");
  if (backendUrl && !isHttpUrl(backendUrl)) {
    problems.push("Release candidate Backend URL must be a valid HTTP(S) URL");
  }

  if (!/\|\s*iOS\s*\|[^|\n]+?\|[^|\n]+?\|[^|\n]+?\|[^|\n]+?\|\s*pass\s*\|[^|\n]+\|/i.test(report)) {
    problems.push("Platform results must include an iOS pass row with evidence");
  }
  if (!/\|\s*Android\s*\|[^|\n]+?\|[^|\n]+?\|[^|\n]+?\|[^|\n]+?\|\s*pass\s*\|[^|\n]+\|/i.test(report)) {
    problems.push("Platform results must include an Android pass row with evidence");
  }

  for (const finalCheck of requiredFinalChecks) {
    if (!report.includes(finalCheck)) {
      problems.push(`Final release decision must include checked item: ${finalCheck}`);
    }
  }

  for (const label of requiredGateLabels) {
    if (!hasNonBlankTableValue(report, label)) {
      problems.push(`Automated gate evidence is missing for: ${label}`);
    }
  }

  for (const label of requiredSmokeEvidenceLabels) {
    const rowPattern = new RegExp(`\\|\\s*${escapedPattern(label)}\\s*\\|\\s*([^|\\n]+?)\\s*\\|\\s*([^|\\n]+?)\\s*\\|\\s*([^|\\n]+?)\\s*\\|`);
    const match = report.match(rowPattern);
    if (!match || match.slice(1, 4).some((cell) => cell.trim().length === 0)) {
      problems.push(`Smoke path evidence is incomplete for: ${label}`);
    }
  }

  return problems;
}

export async function checkReportFile(reportPath) {
  const report = await readFile(reportPath, "utf-8");
  return reportProblems(report);
}

async function main() {
  const reportPath = process.argv[2];
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage());
    return 0;
  }

  if (!reportPath) {
    console.log(usage());
    return 1;
  }

  const problems = await checkReportFile(reportPath);
  if (problems.length > 0) {
    console.error(`Device smoke report check failed for ${basename(reportPath)}:`);
    for (const problem of problems) {
      console.error(`- ${problem}`);
    }
    return 1;
  }

  console.log(`Device smoke report check passed for ${basename(reportPath)}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
