import {
  attributes,
  type FieldState,
  fieldStates,
  isFieldState,
  type NonDefaultFieldState,
} from "../shared.js"

export const FILE_UPLOAD_CLASS = "lt-file-upload" as const
/** The list of the selected files. */
export const FILE_UPLOAD_LIST_CLASS = "lt-file-upload-list" as const

export type FileUploadOptions = {
  /** Validation state. Default: `default`. */
  state?: FieldState
  /** Allow several files. */
  multiple?: boolean
  /** The file types the field accepts, such as `.pdf,image/*`. */
  accept?: string
}

export type FileUploadAttributes = {
  class: typeof FILE_UPLOAD_CLASS
  type: "file"
  multiple?: true
  accept?: string
  "data-state"?: NonDefaultFieldState
  "aria-invalid"?: "true"
}

/**
 * The attributes for a file upload field.
 *
 * The field is a plain `<input type="file">`. The button inside is the
 * browser's own, and its text comes from the operating system's language. It
 * cannot be translated, so the label above the field must say what to upload.
 *
 * `accept` is a help in the file picker, not a barrier. The user can choose
 * "all files", so the type must be checked on the server anyway.
 *
 * ```ts
 * <input {...fileUpload({ multiple: true, accept: ".bin" })} />
 * ```
 */
export const fileUpload = Object.assign(
  ({
    state = "default",
    multiple,
    accept,
  }: FileUploadOptions = {}): FileUploadAttributes =>
    attributes({
      class: FILE_UPLOAD_CLASS,
      type: "file" as const,
      multiple: multiple ? (true as const) : undefined,
      accept,
      "data-state": state === "default" ? undefined : state,
      "aria-invalid": state === "invalid" ? ("true" as const) : undefined,
    }),
  {
    /** The class on the list of selected files. */
    list: FILE_UPLOAD_LIST_CLASS,
    states: fieldStates,
    isState: isFieldState,
  },
)
