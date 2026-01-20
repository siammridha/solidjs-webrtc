# solidjs-webrtc
## This project was created with the [Solid CLI](https://github.com/solidjs-community/solid-cli)

Getting started (install deps and run):

```bash
# install
pnpm install

# start dev server
pnpm dev
```

Notes:
- This app uses manual copy/paste signaling (no signaling server). Create an offer on one peer, copy the Local SDP JSON and paste it into the Remote SDP box on the other peer; create an answer there and copy the answer back.
- The app registers a simple service worker and includes a webmanifest so it can be installed as a PWA.

