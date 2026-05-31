let tiktok = null;

if (tiktokUsername) {
  tiktok = {
    username: tiktokUsername,
    profileUrl: `https://www.tiktok.com/@${encodeURIComponent(tiktokUsername)}`,
    avatarUrl: null,
  };
}