const allowedHosts = new Set(["youtube.com", "www.youtube.com", "music.youtube.com"]);

export function validatePlaylistUrl(input: string): boolean {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:") {
      return false;
    }

    if (!allowedHosts.has(url.hostname.toLowerCase())) {
      return false;
    }

    const list = url.searchParams.get("list");
    return Boolean(list && /^[\w-]+$/.test(list));
  } catch {
    return false;
  }
}

export function getArtistLine(title: string): string {
  const cleaned = title.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").trim();
  const pipeParts = cleaned
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  if (pipeParts.length > 1) {
    return pipeParts.slice(1, 3).join(" • ");
  }

  const dashParts = cleaned
    .split(" - ")
    .map((part) => part.trim())
    .filter(Boolean);

  if (dashParts.length > 1) {
    return dashParts[0];
  }

  return "Audio track";
}
