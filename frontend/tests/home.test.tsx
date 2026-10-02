import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../src/app/page";

test("la portada presenta el acceso y la navegación de SyncPad", () => {
  const html = renderToStaticMarkup(<Home />);

  assert.match(html, /<main[ >]/);
  assert.match(html, /<h1>Tu espacio de notas\.<\/h1>/);
  assert.match(html, /name="email"|type="email"/);
  assert.match(html, /Crear cuenta/);
});
