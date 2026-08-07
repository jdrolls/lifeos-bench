import { readFile, writeFile } from "node:fs/promises";

export type Note = { id: string; title: string; body: string };

export async function loadNotes(path: string): Promise<Note[]> {
  return JSON.parse(await readFile(path, "utf8")) as Note[];
}

export async function saveNotes(path: string, notes: Note[]): Promise<void> {
  await writeFile(path, `${JSON.stringify(notes, null, 2)}\n`);
}
