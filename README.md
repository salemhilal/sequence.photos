# sequence-server

The server side of [Sequence](https://sequence.photos), for posting digital sequences to
Instagram:

- **Sign-in:** exchanges Instagram Login codes for tokens (this needs the Meta app's
  secret, which can't ship in the website or the Mac app).
- **Images:** holds a sequence's frames briefly at public URLs for Instagram to fetch,
  then deletes them.
