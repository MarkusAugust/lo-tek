/// <reference path="../../../types/css.d.ts" />

import { beforeEach, describe, expect, it } from "vitest"

import {
  expectNoAccessibilityViolations,
  mount,
  waitForPaint,
} from "../../../testing/a11y"
import { fileUpload } from "./file-upload"

import "../../../tokens/tokens.css"
import "./file-upload.css"
import "../label/label.css"
import "../help-text/help-text.css"
import "../button/button.css"

describe("lt-file-upload", () => {
  beforeEach(() => {
    mount(`
      <label class="lt-label" for="firmware">Upload firmware</label>
      <input class="lt-file-upload" type="file" id="firmware" multiple
        accept=".bin" aria-describedby="firmware-help" />
      <p class="lt-help-text" id="firmware-help">Deck firmware (.bin, up to 64 MB). Dump it before I open anything.</p>

      <ul class="lt-file-upload-list">
        <li>firmware-0331.bin <button class="lt-button" data-variant="ghost" type="button">Remove firmware-0331.bin</button></li>
      </ul>
    `)
  })

  it("is a plain file input", () => {
    const input = document.getElementById("firmware") as HTMLInputElement

    expect(input.type).toBe("file")
    expect(input.multiple).toBe(true)
    expect(input.accept).toBe(".bin")
  })

  it("styles the browser's own button inside the input", () => {
    const button = getComputedStyle(
      document.getElementById("firmware") as Element,
      "::file-selector-button",
    )

    expect(button.borderTopWidth).toBe("1px")
  })

  it("sets the attributes from the builder function", () => {
    expect(fileUpload()).toEqual({ class: "lt-file-upload", type: "file" })
    expect(
      fileUpload({ multiple: true, accept: ".bin", state: "invalid" }),
    ).toEqual({
      class: "lt-file-upload",
      type: "file",
      multiple: true,
      accept: ".bin",
      "data-state": "invalid",
      "aria-invalid": "true",
    })
    expect(fileUpload.list).toBe("lt-file-upload-list")
  })

  it("has no accessibility violations", async () => {
    await waitForPaint()
    await expectNoAccessibilityViolations()
  })
})
