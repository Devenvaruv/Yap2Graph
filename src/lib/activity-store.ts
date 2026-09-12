import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { Activity } from "./schemas";

/**
 * Default location of the inspectable JSON activity store (PRD story 13:
 * no database). Pipeline runs write here; the UI and tests may pass an
 * explicit path instead.
 */
export const DEFAULT_ACTIVITY_STORE_PATH = "data/activities.json";

const ActivityList = z.array(Activity);

/**
 * Persist the merged activity list to a plain JSON file, atomically: the
 * serialized list lands at `<path>.tmp` first and is then renamed over the
 * target, so a reader never observes a half-written store.
 */
export async function saveActivities(
  activities: readonly Activity[],
  filePath: string = DEFAULT_ACTIVITY_STORE_PATH,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(activities, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

/**
 * Load and validate the activity store. A file that does not parse as
 * `Activity[]` fails loudly — downstream consumers trust these records.
 */
export async function loadActivities(
  filePath: string = DEFAULT_ACTIVITY_STORE_PATH,
): Promise<Activity[]> {
  const parsed = ActivityList.safeParse(JSON.parse(await readFile(filePath, "utf8")));
  if (!parsed.success) {
    throw new Error(
      `Activity store at \"${filePath}\" failed validation:\n${parsed.error.message}`,
    );
  }
  return parsed.data;
}
