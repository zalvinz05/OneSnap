# OneSnap-Reporting-App
Designed specifically for Malaysians, this app makes it easy to report civic issues such as potholes, vandalized public facilities, or illegal dumping. Simply snap a photo, provide a brief description, and submit your report directly to the relevant authorities.

## Prerequisites
Before running the project, you need to download and install the following core tools:
* **Node.js**: LTS version recommended.
* **Java Development Kit (JDK)**: JDK 17 is recommended for modern React Native projects.
* **Android Studio**: Even though you are using a physical device, Android Studio is required to install the necessary Android SDK, Android SDK Platform, and Build-Tools.

## Environment Variables Setup (Windows)
To allow your computer to communicate with Android devices and the emulator, you must set up your environment variables:
1. Open the Windows Windows Search bar and look for **"Edit the system environment variables"**.
2. Click on **Environment Variables...**
3. Under **User variables**, click **New...** to create a new `ANDROID_HOME` variable. Set the value to the path of your Android SDK (usually `%LOCALAPPDATA%\Android\Sdk`).
4. Select the **Path** variable, click **Edit**, and add the following paths:
   * `%LOCALAPPDATA%\Android\Sdk\platform-tools`
   * `%LOCALAPPDATA%\Android\Sdk\emulator`

## How to Run on a Physical Device
This guide assumes you are testing on an Android device. Instead of using a resource-heavy virtual machine, you can run the app directly on your phone using USB debugging.

### Step 1: Enable USB Debugging
1. On your phone, go to **Settings** > **About phone**.
2. Tap on the **Build number** 7 times to unlock Developer Options.
3. Go back to **Settings**, navigate to **Developer options** (sometimes found under System settings).
4. Scroll down and turn on **USB debugging**.

### Step 2: Connect Your Phone
1. Connect your Android phone to your computer via a USB cable.
2. A prompt should appear on your phone asking to "Allow USB debugging?". Check "Always allow from this computer" and tap **OK**.

## How to Create a New Project (For Developers)
If you are setting up this project from scratch or want to create your own React Native app without using a framework like Expo, follow these steps:

### Step 1: Initialize the Project
Use the React Native Community CLI to bootstrap a new project. Open your terminal in the directory where you want your project to live and run:
  ```bash
  npx @react-native-community/cli init OneSnap --version="0.73"
  ```
### Step 2: Navigate to the Project Directory
Once the initialization process is complete and all template files are generated, move into your new project folder:
  ```bash
  cd OneSnapReportingApp
  ```
### Step 3: Install Dependencies
Install the core Node packages required for the project. Run this in your terminal:
 ```bash
 npm install
 ```
 ```bash
 npm install react-native-vision-camera react-native-image-picker
 ```
Since this app relies on capturing images of civic issues, you also need to install the required camera packages:

### Step 4: Verify Your Device Setup
Before running the app, ensure your physical Android device is connected and USB debugging is enabled. You can verify your device is recognized by running:
 ```bash
 adb devices
 ```
###Step 5: Run the App
To start the Metro Bundler and build the app on your connected device or emulator simultaneously, run this single command:
 ```bash
npx react-native run-android
 ```
## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [Introduction to React Native](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you can't get this to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
