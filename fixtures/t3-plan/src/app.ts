import { join } from "node:path";
import { loadNotes, saveNotes, type Note } from "./store";

const storePath = join(import.meta.dir, "../data/store.json");

export async function listNotes(): Promise<Note[]> {
  return loadNotes(storePath);
}

export async function addNote(note: Note): Promise<void> {
  const notes = await loadNotes(storePath);
  notes.push(note);
  await saveNotes(storePath, notes);
}
