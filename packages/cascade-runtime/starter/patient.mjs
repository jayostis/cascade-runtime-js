// `npm run patient:add -- <hospital folder> <file>`: checks a patient's file against the hospital's folder and writes it
// to that hospital's `patients/`. The file is a FHIR Bundle of the records, with their dates (a `history` Bundle), as
// they are (a `collection` Bundle), or with `shorthand` to compile.
import { argv, stdout } from "node:process";
import { HospitalDataError } from "@cascade-runtime/demo-hospital";
import { addPatient } from "@cascade-runtime/demo-hospital/node";
import { argumentsOf, refuse } from "./pods.mjs";

const { positionals } = argumentsOf(
  argv.slice(2),
  "npm run patient:add -- <hospital folder> <file>",
  {},
  2,
);
const [folder, file] = positionals;
try {
  const written = await addPatient(folder, file);
  stdout.write(
    `Added ${written}. If the app is running, restart it to see the patient.\n`,
  );
} catch (error) {
  if (!(error instanceof HospitalDataError)) throw error;
  refuse(error.message);
}
