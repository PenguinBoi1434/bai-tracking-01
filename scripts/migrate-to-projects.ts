/**
 * One-time migration: backfill existing points into a default Project.
 *
 * Authenticates with Cognito directly (since this is a standalone script with
 * no browser session), then:
 *   1. Creates a default Project ("Bent, NM") if one doesn't exist.
 *   2. Finds every Point with no projectId.
 *   3. Sets each one's projectId to the default project.
 *
 * Usage:
 *   npx tsx scripts/migrate-to-projects.ts <email> <password>
 *
 * Example:
 *   npx tsx scripts/migrate-to-projects.ts lhqia123@gmail.com myPassword123
 */
import { Amplify } from "aws-amplify";
import { signIn } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";
import outputs from "../amplify_outputs.json";

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error("Usage: npx tsx scripts/migrate-to-projects.ts <email> <password>");
  process.exit(1);
}

const DEFAULT_PROJECT = {
  name: "Bent, NM",
  lat: 33.1581,
  lng: -105.8572,
  zoom: 14,
};

async function main() {
  // 1. Authenticate so the data client has a valid token.
  console.log(`Signing in as ${email}...`);
  Amplify.configure(outputs);
  await signIn({ username: email, password });
  console.log("Signed in.");

  const client = generateClient<Schema>();

  // 2. Find or create the default project by name.
  const { data: existing } = await client.models.Project.list({
    filter: { name: { eq: DEFAULT_PROJECT.name } },
  });

  let projectId: string;
  if (existing && existing.length > 0) {
    projectId = existing[0].id;
    console.log(`Found existing default project: ${projectId}`);
  } else {
    const { data: created, errors } = await client.models.Project.create(DEFAULT_PROJECT);
    if (errors) throw new Error(`Failed to create default project: ${JSON.stringify(errors)}`);
    projectId = created!.id;
    console.log(`Created default project "${DEFAULT_PROJECT.name}": ${projectId}`);
  }

  // 3. Find all points with no projectId and assign them.
  let updated = 0;
  const { data: allPoints, errors: listErrors } = await client.models.Point.list();
  if (listErrors) throw new Error(`Failed to list points: ${JSON.stringify(listErrors)}`);

  console.log(`Total points in database: ${allPoints.length}`);
  for (const point of allPoints) {
    console.log(`  point ${point.id} — projectId: ${JSON.stringify(point.projectId)} — location: ${point.location ?? "(none)"}`);
  }

  for (const point of allPoints) {
    if (point.projectId) continue; // already assigned
    await client.models.Point.update({ id: point.id, projectId });
    updated++;
    console.log(`  backfilled point ${point.id}`);
  }

  console.log(`\nDone. Backfilled ${updated} point(s) into project "${DEFAULT_PROJECT.name}".`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
