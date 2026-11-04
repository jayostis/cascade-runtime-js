import type { Files } from "@cascade-runtime/runtime";

export const TERMS_PAGE = "terms/index.html";

export async function termReference(_vocabulary: Files): Promise<string> {
  return "<!DOCTYPE html>\n";
}
