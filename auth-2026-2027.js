
(function () {
  "use strict";

  const auth = firebase.auth();

  const emailInput = document.getElementById("authEmail");
  const passwordInput = document.getElementById("authPassword");
  const status = document.getElementById("authStatus");

  const signInBtn = document.getElementById("signInBtn");
  const registerBtn = document.getElementById("registerBtn");
  const resetPasswordBtn = document.getElementById("resetPasswordBtn");
  const verifyBtn = document.getElementById("verifyEmailBtn");
  const signOutBtn = document.getElementById("signOutBtn");

  const allowedDomains = ["natur.cuni.cz", "uochb.cas.cz"];

  function validEmail(email) {
    const parts = email.trim().toLowerCase().split("@");
    return parts.length === 2 &&
      parts[0].length > 0 &&
      allowedDomains.includes(parts[1]);
  }

  function showStatus(message) {
    status.textContent = message;
  }

  function updateUI(user) {
    const authorized = Boolean(
      user && user.emailVerified && validEmail(user.email || "")
    );

    signOutBtn.style.display = user ? "inline-block" : "none";
    signInBtn.style.display = user ? "none" : "inline-block";
    registerBtn.style.display = user ? "none" : "inline-block";
    resetPasswordBtn.style.display = user ? "none" : "inline-block";
    verifyBtn.style.display =
      user && !user.emailVerified ? "inline-block" : "none";

    window.votingUserAuthorized = authorized;

    if (typeof window.updateVotingAccess === "function") {
      window.updateVotingAccess();
    }

    if (!user) {
      showStatus("Please sign in to vote.");
    } else if (!validEmail(user.email || "")) {
      showStatus("This account does not use an approved institutional email.");
    } else if (!user.emailVerified) {
      showStatus("Please verify your email address before voting.");
    } else {
      showStatus("Signed in as " + user.email);
    }
  }

  signInBtn.addEventListener("click", async function () {
    try {
      const email = emailInput.value.trim().toLowerCase();

      if (!validEmail(email)) {
        throw new Error("Please use an approved institutional email.");
      }

      const result = await auth.signInWithEmailAndPassword(
        email,
        passwordInput.value
      );

      await result.user.reload();
      updateUI(auth.currentUser);
      passwordInput.value = "";
    } catch (error) {
      showStatus(error.message);
    }
  });

  registerBtn.addEventListener("click", async function () {
    try {
      const email = emailInput.value.trim().toLowerCase();

      if (!validEmail(email)) {
        throw new Error("Please use an approved institutional email.");
      }

      const result = await auth.createUserWithEmailAndPassword(
        email,
        passwordInput.value
      );

      await result.user.sendEmailVerification();

      passwordInput.value = "";
      updateUI(result.user);
      showStatus("Verification email sent. Please check your inbox.");
    } catch (error) {
      showStatus(error.message);
    }
  });

  resetPasswordBtn.addEventListener("click", async function () {
    try {
      const email = emailInput.value.trim().toLowerCase();

      if (!validEmail(email)) {
        throw new Error("Please enter your institutional email address first.");
      }

      await auth.sendPasswordResetEmail(email);

      showStatus(
        "If an account exists for this email, a password reset message " +
        "will be sent. Please check your inbox and spam folder."
      );
    } catch (error) {
      if (
        error.code === "auth/user-not-found" ||
        error.code === "auth/invalid-email"
      ) {
        showStatus(
          "If an account exists for this email, a password reset " +
          "message will be sent."
        );
      } else {
        showStatus(
          "Unable to send the password reset email. " +
          "Please try again later."
        );
        console.error("Password reset failed:", error.code);
      }
    }
  });

  verifyBtn.addEventListener("click", async function () {
    try {
      const user = auth.currentUser;

      if (!user) {
        throw new Error("Please sign in first.");
      }

      await user.reload();

      if (user.emailVerified) {
        updateUI(auth.currentUser);
      } else {
        await user.sendEmailVerification();
        showStatus("Verification email sent. Please check your inbox.");
      }
    } catch (error) {
      showStatus(error.message);
    }
  });

  signOutBtn.addEventListener("click", async function () {
    try {
      await auth.signOut();
    } catch (error) {
      showStatus(error.message);
    }
  });

  auth.onAuthStateChanged(updateUI);
})();
