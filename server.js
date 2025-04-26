const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5e6
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let ffmpegProcess = null;
let isStreamActive = false;

function startFFmpeg() {
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGINT');
    ffmpegProcess = null;
  }
  
  console.log('Starting FFmpeg stream (in JPEG format)...');
  
  const ffmpegArgs = [
    '-f', 'gdigrab',
    '-framerate', '10',
    '-i', 'desktop',
    '-vf', 'scale=1280:-1',
    '-q:v', '10',
    '-update', '1',
    '-y',
    path.join(__dirname, 'public', 'stream.jpg')
  ];

  ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
  isStreamActive = true;

  ffmpegProcess.stderr.on('data', (data) => {
    console.log('FFmpeg log: ' + data);
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`FFmpeg closed, code: ${code}`);
    ffmpegProcess = null;
    isStreamActive = false;
    
    if (code !== 0) {
      console.log('FFmpeg closed with an error, restarting...');
      setTimeout(startFFmpeg, 2000);
    }
  });
  
  return ffmpegProcess;
}

let frameCount = 0;
let lastModified = 0;
const checkAndSendFrame = () => {
  const jpegPath = path.join(__dirname, 'public', 'stream.jpg');
  
  try {
    const stats = fs.statSync(jpegPath);
    if (stats.mtimeMs > lastModified) {
      lastModified = stats.mtimeMs;
      frameCount++;
      io.emit('frame-update', { 
        timestamp: Date.now(),
        frameCount: frameCount
      });
    }
  } catch (err) {
  }
};

server.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
  startFFmpeg();
  
  setInterval(checkAndSendFrame, 100);
});

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  if (!isStreamActive) {
    console.log('Stream is not active, restarting...');
    startFFmpeg();
  }
  
  socket.emit('stream-status', { active: isStreamActive, frameCount: frameCount });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    if (io.engine.clientsCount === 0 && ffmpegProcess) {
      console.log('Last client disconnected, stopping FFmpeg');
      ffmpegProcess.kill('SIGINT');
      ffmpegProcess = null;
      isStreamActive = false;
    }
  });
});