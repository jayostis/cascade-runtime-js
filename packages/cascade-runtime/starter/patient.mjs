// `npm run patient:add -- <hospital id> <file>`: checks a patient's file against that hospital, the package's or one of
// `hospitals/`, and the people already there, and writes it to `people/<patient id>/sources/<hospital id>/fhir.json`,
// with the person's `person.json` when they have none. The file is a FHIR Bundle of the records, with their dates (a
// `history` Bundle), as they are (a `collection` Bundle), or with `shorthand` to compile.
import { argv, stdout } from "node:process";
import { fileURLToPath, URL } from "node:url";
import { HospitalDataError } from "@the-cascade-protocol/sandbox";
import { addPatient } from "@the-cascade-protocol/sandbox/node";
import { argumentsOf, refuse } from "./pods.mjs";

const { positionals } = argumentsOf(
  argv.slice(2),
  "npm run patient:add -- <hospital id> <file>",
  {},
  2,
);
const [hospital, file] = positionals;
try {
  const written = await addPatient(
    fileURLToPath(new URL(".", import.meta.url)),
    hospital,
    file,
  );
  stdout.write(
    `Added ${written}. If the app is running, restart it to see the patient.\n`,
  );
} catch (error) {
  if (!(error instanceof HospitalDataError)) throw error;
  refuse(error.message);
}
