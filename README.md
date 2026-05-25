# SurveySync: Working Model

SurveySync is a tool designed to synchronize survey data efficiently. This repository focuses on **Method 3**, which utilizes MongoDB for data synchronization.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Usage](#usage)
- [Tracking](#tracking)
- [Troubleshooting](#troubleshooting)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Data Synchronization](#data-synchronization)
- [Error Handling](#error-handling)
- [Contributing](#contributing)
- [License](#license)

## Overview

This method leverages MongoDB's capabilities to manage and synchronize survey data in real-time. By utilizing MongoDB's replication and change streams, SurveySync ensures that all survey responses are consistently updated across different platforms.

## Features

- **Real-time Data Synchronization**: Utilizes MongoDB's replication and change streams to keep data consistent across platforms.
- **Scalability**: Handles large volumes of survey data efficiently.
- **Flexibility**: Easily adaptable to various survey formats and structures.

## Usage
- Open your browser and navigate to [SurveySync | Admin](https://esp8266-control.onrender.com/) to access the SurveySync dashboard.
- When the website has completely loaded, go to the `Activity` section and click `Connect`
- Continue to the next step if the text `New Client Added | Total = 1` shows in the terminal. If connection fails, it means the website has not completly loaded yet.
- Plug in the ESP8266 module into a power source. If the module was previously connected to a WiFi that still exists, it will connect to it. Else, the blue light will stay on.
    -  If the blue light stays on, open your phone/laptop and look for a WiFi network called `ESP8266 - Control` and connect to it using password `surveysync`.
    -  Connecting to the WiFi redirects you to a control page, select `Connect to WiFi` and enter the credentials, then click `Save`
- Once the module has connected to WiFi, the blue light blinks 2 times
- After this, it will attempt connecting to the website. The text `New Client Added | Total = 2` will show on the website activity terminal, and the blue light will blink 3 times. A test data will be sent, and will show up on the terminal.
- Every time a signal is sent, it will show up on the terminal, and the blue light will blink quickly

## Tracking
- To track the Help Calls for all active labs, go to [SurveySync | Help](https://help-responses.onrender.com/)
- To see data about voting for separate labs, rooms and other parameters, go to [SurveySync | Dashboard](https://dashboard-e9g1.onrender.com/)
## Troubleshooting
To torubleshoot, it is important to know what the ESP light means:
- `Single Quick Blink`: WiFi and Websocket are connected, and data was just sent
- `Two Blinks` : Conneted to WiFi using saved Credentials
- `Three Blinks` : Connected to Website/Websocket
- `10 Slow Blinks` : Websocket disconnected, will try connecting back to the Website after light stops blinking
- `Static Blue Light`: Couldn't connect to last saved WiFi, please connect to `ESP8266 - Control` and enter WiFi credentials
  
To troubleshoot, the following scenarios are possible. In each scenario, a problem is indicated by 10 slow blinks.
### Static blue light starts slow blinking after saving credentials, or doesn't blink for a long time
Usually means that the WiFi credentials provided did not work, and it's trying to reconnect again and again. After some time, the static light will reappaer
### Blinks twice, and then slow blinking starts
Means that the ESP8266 was not able to connect to the websocket. The only reason for this is that the website wasn't loaded properly before connecting the ESP8266 to WiFi. Loading the website will eventually cause the ESP8266 to connect to it.
### Was working correctly but starts slow blinking
WiFi network disconnected. Fastest way to fix it to switch it off, and on again; and check if static blue light appears.

# Duplicating the Process
If you wish to duplicate this on your localhost, do the following:
## Prerequisites

Before setting up SurveySync, ensure you have the following:

- **MongoDB**: A running instance of MongoDB. For optimal performance, a replica set configuration is recommended. ([MongoDB Documentation](https://www.mongodb.com/docs/manual/core/replica-set-sync/))
- **Node.js**: Version 14.x or higher.
- **npm**: Node package manager.

## Installation

1. **Clone the Repository**:

   ```bash
   git clone https://github.com/Snehgal/SurveySync.git
   ```
2. ** Navigate to the Method3_MongoDBmethod Directory:**

    ```bash
    cd SurveySync/Method3_MongoDBmethod
    ```
3. ** Install Dependencies **
   ```bash
   npm install
   ```

## Data Synchronization
SurveySync employs MongoDB's change streams to monitor real-time changes in the survey data. This ensures that any new responses or updates are immediately reflected across all connected platforms. For more information on MongoDB's change streams, refer to the official MongoDB documentation.
## Error Handling
The application includes error handling mechanisms to manage potential issues during data synchronization. Errors are logged to the console, and in critical cases, the application will attempt to reconnect to the MongoDB instance.

