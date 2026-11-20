/*const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

if (!admin.apps.length) {
  const serviceAccount = require(path.resolve(
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  ));

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

const db = admin.firestore();

module.exports = { admin, db };
*/
/*const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
require('dotenv').config();

if (!getApps().length) {
  const serviceAccount = require(path.resolve(
    process.cwd(),
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  ));

  initializeApp({
    credential: cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

const db = getFirestore();

module.exports = { db };*/

/*const firebaseAdmin = require('firebase-admin');
const admin = firebaseAdmin.default || firebaseAdmin;
const path = require('path');
require('dotenv').config();

if (!admin.apps?.length) {
  const serviceAccount = require(path.resolve(
    process.cwd(),
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  ));

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

const db = admin.firestore();

module.exports = { admin, db };*/

/*const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
require('dotenv').config();

if (!getApps().length) {
  const serviceAccount = require(path.resolve(
    process.cwd(),
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  ));

  initializeApp({
    credential: cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

const db = getFirestore();

module.exports = { db };*/

/*const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
require('dotenv').config();

if (!getApps().length) {
  const serviceAccount = require(path.resolve(
    process.cwd(),
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  ));

  // Ensure newlines in private_key are properly formatted
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(
      /\\n/g,
      '\n'
    );
  }

  initializeApp({
    credential: cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

const db = getFirestore();

module.exports = { db };*/

const admin = require('firebase-admin');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
require('dotenv').config();

const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
  universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
};

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

const auth = getAuth();
const db = getFirestore();

module.exports = { admin, auth, db };
