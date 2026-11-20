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

const { initializeApp, getApps, cert } = require('firebase-admin/app');
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

module.exports = { db };
