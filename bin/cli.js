#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rc = require('rc');

// Define the base directory of the CLI project.
// Adjust this if your CLI file is not located in a subdirectory relative to your package.json.
const BASE_DIR = path.resolve(__dirname, '..');

// Define the location of the configuration file.
const CONFIG_PATH = path.join(os.homedir(), '.gatherspotifyrc');

// Utility: Scaffold a basic configuration file.
const runInit = () => {
  const DEFAULT_CONFIG = {
    gather: {
      apiKey: "",
      spaceId: ""
    },
    spotify: {
      clientId: "",
      clientSecret: "",
      accessToken: "",
      refreshToken: ""
    }
  };

  if (fs.existsSync(CONFIG_PATH)) {
    console.log(`Configuration file already exists at ${CONFIG_PATH}`);
    process.exit(0);
  }

  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), { mode: 0o600 });
    console.log(`Basic configuration file created at ${CONFIG_PATH}.\nPlease edit it with your credentials.`);
  } catch (err) {
    console.error('Failed to create configuration file:', err);
    process.exit(1);
  }
  process.exit(0);
};

// Utility: Show help message.
const showHelp = (exitCode = 0) => {
  console.log(`
Usage: gather-spotify [option]

Available commands:
  init         Scaffold a basic configuration file at ${CONFIG_PATH} (if one does not exist), then exit.
  token        Run the 'spotify-oauth-cli' cli. Captures tokens from output and updates the configuration file.
  help         Display this help message.
  [no command] Run the listener server. Requires Spotify access and refresh tokens to be present in the configuration.

This CLI tool:
  - Helps manage Gather and Spotify listener integrations.
  - Requires a configuration file at ${CONFIG_PATH} with Gather and Spotify credentials.

For additional information, please refer to the documentation.
  
Examples:
  $ gather-spotify init
  $ gather-spotify token
  $ gather-spotify
  $ gather-spotify help
  `);
  process.exit(exitCode);
};

// Process command line arguments.
const args = process.argv.slice(2);
const command = args[0];

// Immediately handle help and init commands.
if (command === 'help' || command === '--help' || command === '-h') {
  showHelp();
}

if (command === 'init') {
  runInit();
}

// Load configuration using rc under the name "gatherspotify".
// The rc module will search various places for configuration and return an object.
const CONFIG = rc('gatherspotify');

// Determine which npm script to run.
// Default (no command) is 'start', "token" uses 'get-token'.
let npmScript;
if (!command) {
  npmScript = 'start';
} else if (command === 'token') {
  npmScript = 'get-token';
} else {
  console.error('Usage: gather-spotify [token|init|help]');
  showHelp(1);
}

// Validate that required Gather configuration exists.
if (!CONFIG.gather || !CONFIG.gather.apiKey || !CONFIG.gather.spaceId) {
  console.error('Missing required gather configuration in your configuration file.');
  showHelp(1);
}

// Validate that required Spotify client configuration exists.
if (!CONFIG.spotify || !CONFIG.spotify.clientId || !CONFIG.spotify.clientSecret) {
  console.error('Missing required spotify client configuration in your configuration file.');
  showHelp(1);
}

// Map configuration values to environment variables.
process.env.GATHER_API_KEY = CONFIG.gather.apiKey;
process.env.GATHER_SPACE_ID = CONFIG.gather.spaceId;
process.env.SPOTIFY_CLIENT_ID = CONFIG.spotify.clientId;
process.env.SPOTIFY_CLIENT_SECRET = CONFIG.spotify.clientSecret;

// For the "start" command, tokens are required.
if (npmScript === 'start') {
  if (!CONFIG.spotify.accessToken || !CONFIG.spotify.refreshToken) {
    console.error('Missing spotify tokens in configuration for "start" command.');
    process.exit(1);
  }
  process.env.SPOTIFY_ACCESS_TOKEN = CONFIG.spotify.accessToken;
  process.env.SPOTIFY_REFRESH_TOKEN = CONFIG.spotify.refreshToken;
}

// Set spawn options with the working directory set to BASE_DIR.
// For the "token" command, capture stdout to parse token output; otherwise, inherit all stdio.
const spawnOptions = 
  command === 'token'
    ? { cwd: BASE_DIR, stdio: ['inherit', 'pipe', 'inherit'], env: process.env }
    : { cwd: BASE_DIR, stdio: 'inherit', env: process.env };

// Spawn the designated npm script.
const child = spawn('npm', ['run', npmScript], spawnOptions);

// For the "token" command, accumulate stdout output.
let outputData = '';
if (command === 'token') {
  child.stdout.on('data', (data) => {
    const text = data.toString();
    outputData += text;
    process.stdout.write(text); // Also output to the console.
  });
}

// When the child process exits, perform post-processing if needed.
child.on('exit', (code) => {
  if (command === 'token') {
    // Use regex to extract tokens from expected output lines.
    const accessTokenMatch = outputData.match(/Your access token is:\s*(\S+)/);
    const refreshTokenMatch = outputData.match(/Your refresh token is:\s*(\S+)/);

    if (accessTokenMatch && refreshTokenMatch) {
      const newAccessToken = accessTokenMatch[1];
      const newRefreshToken = refreshTokenMatch[1];

      // Read the current configuration from CONFIG_PATH.
      let currentConfig = {};
      if (fs.existsSync(CONFIG_PATH)) {
        try {
          currentConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        } catch (err) {
          console.error('Failed to parse the existing config file at', CONFIG_PATH);
          process.exit(1);
        }
      } else {
        console.error(`Configuration file not found at ${CONFIG_PATH}`);
        process.exit(1);
      }

      if (!currentConfig.spotify) {
        currentConfig.spotify = {};
      }

      // Update tokens.
      currentConfig.spotify.accessToken = newAccessToken;
      currentConfig.spotify.refreshToken = newRefreshToken;

      try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(currentConfig, null, 2));
        console.log('\nConfiguration updated successfully!');
      } catch (err) {
        console.error('Failed to update the config file:', err);
        process.exit(1);
      }
    } else {
      console.error('Failed to extract tokens from output.');
    }
  }
  process.exit(code);
});
