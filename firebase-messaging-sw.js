importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

firebase.initializeApp({
  apiKey: 'AIzaSyA1lkOgOfvmM49o4G4B8ZgoMglAPjNdD5w',
  authDomain: 'kyniemlop-d3404.firebaseapp.com',
  projectId: 'kyniemlop-d3404',
  storageBucket: 'kyniemlop-d3404.firebasestorage.app',
  messagingSenderId: '824232517330',
  appId: '1:824232517330:web:acf65afe55dac4d38b970b',
  measurementId: 'G-XG46M01K89'
});

const messaging = firebase.messaging();

messaging.setBackgroundMessageHandler((payload) => {
  const title = payload?.notification?.title || payload?.data?.title || 'Thông báo mới';
  const body = payload?.notification?.body || payload?.data?.body || '';

  return self.registration.showNotification(title, {
    body,
    icon: 'https://www.gstatic.com/mobilesdk/160503_mobilesdk/logo/2x/firebase_28dp.png',
    data: payload?.data || {}
  });

});
