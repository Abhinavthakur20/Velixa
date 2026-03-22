const FORBIDDEN_CHARS_REGEX = /[\/\\:*?"<>|]/g;
const MULTI_SPACE_REGEX = /\s+/g;
const MAX_FILENAME_LENGTH = 200;

function sanitize(value: string): string {
  return value
    .replace(FORBIDDEN_CHARS_REGEX, "")
    .replace(MULTI_SPACE_REGEX, " ")
    .trim()
    .slice(0, MAX_FILENAME_LENGTH);
}

export function sanitizeFilename(name: string): string {
  return sanitize(name) || "untitled";
}

export function sanitizePlaylistTitle(title: string): string {
  return sanitize(title) || "playlist";
}
