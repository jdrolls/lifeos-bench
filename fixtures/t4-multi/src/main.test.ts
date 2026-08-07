import { expect, test } from "bun:test";
import { renderHome } from "./main";

test("renders a welcome heading", () => {
  expect(renderHome()).toContain("Welcome");
});
