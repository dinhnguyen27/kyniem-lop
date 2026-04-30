(function initFirebaseServices(global) {
    const firebaseConfig = {
        apiKey: "AIzaSyA1lkOgOfvmM49o4G4B8ZgoMglAPjNdD5w",
        authDomain: "kyniemlop-d3404.firebaseapp.com",
        projectId: "kyniemlop-d3404",
        storageBucket: "kyniemlop-d3404.firebasestorage.app",
        messagingSenderId: "824232517330",
        appId: "1:824232517330:web:acf65afe55dac4d38b970b",
        measurementId: "G-XG46M01K89"
    };

    if (!global.firebase) {
        throw new Error('Firebase SDK chưa được tải trước firebase-init.js');
    }

    const app = global.firebase.apps.length
        ? global.firebase.app()
        : global.firebase.initializeApp(firebaseConfig);

    global.firebaseServices = {
        app,
        auth: global.firebase.auth(),
        db: global.firebase.firestore(),
        storage: global.firebase.storage ? global.firebase.storage() : null,
        config: firebaseConfig
    };
})(window);
