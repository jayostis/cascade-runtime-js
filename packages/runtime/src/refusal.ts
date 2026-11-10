/** A step the rules refuse: it writes no file of the person's, and the replay goes on. */
export class Refusal extends Error {
  override readonly name = "Refusal";
}
