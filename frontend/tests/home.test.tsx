import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../src/app/page";

test("la portada presenta SyncPad y su objetivo sin prometer funciones disponibles", () => {
  const html = renderToStaticMarkup(<Home />);

  assert.match(html, /<main[ >]/);
  assert.ok(html.includes("<h1>SyncPad</h1>"));
  assert.match(html, /Nuestro objetivo es crear un espacio de notas y documentos colaborativos/);
  assert.match(html, /en tiempo real y también offline/);
  assert.match(html, /La colaboración, la edición y el acceso de usuarios aún no están implementados/);
  assert.doesNotMatch(html, /<(button|input|form)[ >]/);
});
