import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ReadOnlyDevRevClient } from "../api/readOnlyClient.js";
import { resolveOrgIdentity, formatOrgBanner } from "../api/devUsers.js";
import { loadEnvFiles, requireEnv } from "../config/loadEnv.js";
import { gatherSnapshot, type SnapshotOptions } from "../snapshot/gather.js";

export type SnapshotCliArgs = {
  output?: string;
  noWorks?: boolean;
  noCustomers?: boolean;
  maxWorks?: number;
  maxAccounts?: number;
  maxArticles?: number;
  json?: boolean;
};

export async function snapshotCommand(args: SnapshotCliArgs): Promise<void> {
  loadEnvFiles();

  const pat = requireEnv("DEVREV_PAT");
  const client = new ReadOnlyDevRevClient({ pat });

  const orgId = await resolveOrgIdentity(client);

  if (!args.json) {
    console.log(`\n  Snapshotting org: ${formatOrgBanner(orgId)}`);
    console.log(`\n📸 Gathering org objects…\n`);
  }

  const opts: SnapshotOptions = {
    noWorks: args.noWorks,
    noCustomers: args.noCustomers,
    maxWorks: args.maxWorks,
    maxAccounts: args.maxAccounts,
    maxArticles: args.maxArticles,
  };

  const { blueprint, stats } = await gatherSnapshot(
    client,
    orgId.orgName ?? "DevRev Org",
    opts,
    args.json ? undefined : (msg) => console.log(`  ${msg}`),
  );

  const outputPath = resolve(args.output ?? `snapshot-${Date.now()}.json`);
  const jsonStr = JSON.stringify(blueprint, null, 2);
  await writeFile(outputPath, jsonStr, "utf8");

  const totalObjects = Object.values(stats).reduce((a, b) => a + b, 0);

  if (args.json) {
    process.stdout.write(
      JSON.stringify({ outputPath, stats, totalObjects }) + "\n",
    );
    return;
  }

  console.log(`\n  📊 Captured:`);
  console.log(`     Parts:         ${stats.parts}`);
  console.log(`     Tags:          ${stats.tags}`);
  console.log(`     Custom stages: ${stats.custom_stages}`);
  console.log(`     Groups:        ${stats.groups}`);
  console.log(`     Accounts:      ${stats.accounts}`);
  console.log(`     Rev orgs:      ${stats.rev_orgs}`);
  console.log(`     Rev users:     ${stats.rev_users}`);
  console.log(`     Works:         ${stats.works}`);
  console.log(`     Articles:      ${stats.articles}`);
  console.log(`\n✓ Snapshot written to: ${outputPath}`);
  console.log(`  Total objects: ${totalObjects}`);
  console.log(`\nNext steps:`);
  console.log(`  Review and edit the snapshot before applying — remove sensitive data,`);
  console.log(`  trim works to a representative sample, and adjust any refs that collide.`);
  console.log(`  Then apply to a fresh org:`);
  console.log(`    dia plan --blueprint ${outputPath}`);
  console.log(`    dia apply`);
}
