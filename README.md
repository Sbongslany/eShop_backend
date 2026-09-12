# eShop_backend

run firebase backend
firebase emulators:start

dir functions
deploy
firebase deploy --only functions

dir functions
build
npm run build