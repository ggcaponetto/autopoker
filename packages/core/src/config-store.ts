import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProfileSchema, type Profile } from '@autopoker/shared';

/** Persists profiles as schema-validated JSON files, one per profile. */
export class ProfileStore {
  constructor(private readonly dir: string) {}

  async list(): Promise<Profile[]> {
    await mkdir(this.dir, { recursive: true });
    const profiles: Profile[] = [];
    for (const file of (await readdir(this.dir)).filter((name) => name.endsWith('.json'))) {
      try {
        const raw = await readFile(path.join(this.dir, file), 'utf8');
        profiles.push(ProfileSchema.parse(JSON.parse(raw)));
      } catch {
        // Skip unreadable or schema-invalid files rather than failing the whole list.
      }
    }
    return profiles.sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(profileId: string): Promise<Profile | undefined> {
    try {
      const raw = await readFile(this.file(profileId), 'utf8');
      return ProfileSchema.parse(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }

  async save(profile: Profile): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(profile.id), JSON.stringify(profile, null, 2));
  }

  async delete(profileId: string): Promise<void> {
    await rm(this.file(profileId), { force: true });
  }

  private file(profileId: string): string {
    return path.join(this.dir, `${profileId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  }
}
