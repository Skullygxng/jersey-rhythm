Drop song files in this folder (media/imports) using this naming pattern:

Artist - Title.mp3
Artist - Title.mp4
Artist - Title.png

Optional chart file:
Artist - Title.beatmap.json

Optional metadata file:
Artist - Title.meta.json

Example meta file:
{
  "bpm": 160,
  "title": "Vibe If I Back It Up",
  "artist": "Cookiee Kawaii"
}

Then run:
node scripts/importSongs.js

Imported media is served directly from this folder. The script does not create
duplicate copies in a separate library folder.
