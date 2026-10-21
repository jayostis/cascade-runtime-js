/** A step the rules refuse: it writes nothing, and the replay goes on. */
export class Refusal extends Error {
  override readonly name = "Refusal";
}
