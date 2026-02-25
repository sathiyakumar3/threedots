// ── Firebase configuration & initialisation ──
const firebaseConfig = {
  apiKey: "AIzaSyBpkOQE7zdXU4tBq5z2V3R04dOh-eJ3G9o",
  authDomain: "threedots-92cd6.firebaseapp.com",
  projectId: "threedots-92cd6",
  storageBucket: "threedots-92cd6.firebasestorage.app",
  messagingSenderId: "64245808992",
  appId: "1:64245808992:web:bee8ef86cd8e6f8de4a805",
  measurementId: "G-1Y1LXFGZ56"
};

firebase.initializeApp(firebaseConfig);

const db             = firebase.firestore();
const auth           = firebase.auth();
const analytics      = firebase.analytics();
const googleProvider    = new firebase.auth.GoogleAuthProvider();
const microsoftProvider = new firebase.auth.OAuthProvider('microsoft.com');

console.log('Firebase initialized', firebase.app().name);

// ── Mutable globals shared across all modules ──
let currentUser = null;    // set by onAuthStateChanged in auth.js
let BOARD_ID    = 'main';  // active board; switched in app.js
