// src/MonkeyMazeDemo.js
import React, { useState, useEffect, useRef } from 'react';

// Constants
const WIDTH = 600;
const HEIGHT = 700;
const GRID_SIZE = Math.min(WIDTH, HEIGHT - 100) / 7;
const ROWS = 7;
const COLS = 7;
const COLORS = {
  WHITE: '#FFFFFF',
  BLACK: '#000000',
  BLUE: '#0000FF',
  RED: '#FF0000',
  YELLOW: '#FFFF00',
  GREEN: '#00FF00',
  GREY: '#A9A9A9',
  PURPLE: '#800080',
  FOG: 'rgba(0, 0, 0, 0.95)',
};

// Main component
const MonkeyMazeDemo = () => {
  const canvasRef = useRef(null);
  const [maze, setMaze] = useState([]);
  const [swapPositions, setSwapPositions] = useState([]);
  const [rotatePositions, setRotatePositions] = useState([]);
  const [adjMatrix, setAdjMatrix] = useState([]);
  const [playerPos, setPlayerPos] = useState([0, 0]);
  const [goalPos, setGoalPos] = useState([ROWS - 1, COLS - 1]);
  const [rectLeft, setRectLeft] = useState(true);
  const [rotationAngle, setRotationAngle] = useState(0);
  const [goalRectLeft, setGoalRectLeft] = useState(true);
  const [goalRotationAngle, setGoalRotationAngle] = useState(0);
  const [goalOrder, setGoalOrder] = useState([]);
  const [message, setMessage] = useState("Your goal is to get to the green node as fast as possible. However, first you need to get the clock symbol above the maze to match the clock symbol on the right by rotating the arm 180 degrees by stepping on the red nodes, or 45 anti-clockwise by stepping on the purple nodes");
  const [trial, setTrial] = useState(1);

  useEffect(() => {
    generateMaze();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    drawMaze(ctx);
    drawFog(ctx);
    drawCircleWithRectangle(ctx, rectLeft, rotationAngle, { x: WIDTH / 2, y: 50 });
    drawCircleWithRectangle(ctx, goalRectLeft, goalRotationAngle, { x: WIDTH / 2 + 250, y: 50 });

    const handleKeyDownEvent = (event) => handleKeyDown(event);
    window.addEventListener('keydown', handleKeyDownEvent);

    return () => {
      window.removeEventListener('keydown', handleKeyDownEvent);
    };
  }, [maze, playerPos, rectLeft, rotationAngle, swapPositions, rotatePositions]);

  const generateMaze = () => {
    // Maze generation logic
    let newMaze = Array(ROWS).fill().map(() => Array(COLS).fill(1));
    let newAdjMatrix = Array(ROWS * COLS).fill().map(() => Array(ROWS * COLS).fill(0));
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        for (let neighbor of getNeighbors(row, col)) {
          if (isValidMatrixIndex(neighbor)) {
            newAdjMatrix[row * COLS + col][neighbor[0] * COLS + neighbor[1]] = 1;
          }
        }
      }
    }
    // Logic to randomly remove edges and ensure connectivity
    // ...

    setMaze(newMaze);
    setAdjMatrix(newAdjMatrix);
    // Set swapPositions and rotatePositions
  };

  const getNeighbors = (row, col) => {
    return [
      [row - 1, col],
      [row + 1, col],
      [row, col - 1],
      [row, col + 1]
    ];
  };

  const isValidMatrixIndex = (pos) => {
    return pos[0] >= 0 && pos[0] < ROWS && pos[1] >= 0 && pos[1] < COLS;
  };

  const drawMaze = (ctx) => {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (maze[row][col] === 1) {
          ctx.fillStyle = COLORS.WHITE;
        } else if (maze[row][col] === 2) {
          ctx.fillStyle = COLORS.RED;
        } else if (maze[row][col] === 3) {
          ctx.fillStyle = COLORS.PURPLE;
        }
        ctx.beginPath();
        ctx.arc(col * GRID_SIZE + GRID_SIZE / 2, row * GRID_SIZE + 100 + GRID_SIZE / 2, GRID_SIZE / 4, 0, 2 * Math.PI);
        ctx.fill();

        // Draw edges
        for (let neighbor of getNeighbors(row, col)) {
          if (isValidMatrixIndex(neighbor) && adjMatrix[row * COLS + col][neighbor[0] * COLS + neighbor[1]] === 1) {
            ctx.strokeStyle = COLORS.GREY;
            ctx.beginPath();
            ctx.moveTo(col * GRID_SIZE + GRID_SIZE / 2, row * GRID_SIZE + 100 + GRID_SIZE / 2);
            ctx.lineTo(neighbor[1] * GRID_SIZE + GRID_SIZE / 2, neighbor[0] * GRID_SIZE + 100 + GRID_SIZE / 2);
            ctx.stroke();
          }
        }
      }
    }
    ctx.fillStyle = COLORS.YELLOW;
    ctx.beginPath();
    ctx.arc(0 * GRID_SIZE + GRID_SIZE / 2, 0 * GRID_SIZE + 100 + GRID_SIZE / 2, GRID_SIZE / 4, 0, 2 * Math.PI);
    ctx.fill();

    ctx.fillStyle = COLORS.GREEN;
    ctx.beginPath();
    ctx.arc((COLS - 1) * GRID_SIZE + GRID_SIZE / 2, (ROWS - 1) * GRID_SIZE + 100 + GRID_SIZE / 2, GRID_SIZE / 4, 0, 2 * Math.PI);
    ctx.fill();

    ctx.fillStyle = COLORS.BLUE;
    ctx.beginPath();
    ctx.arc(playerPos[1] * GRID_SIZE + GRID_SIZE / 2, playerPos[0] * GRID_SIZE + 100 + GRID_SIZE / 2, GRID_SIZE / 4, 0, 2 * Math.PI);
    ctx.fill();
  };

  const drawFog = (ctx) => {
    const fogSurface = document.createElement('canvas');
    fogSurface.width = WIDTH;
    fogSurface.height = HEIGHT;
    const fogCtx = fogSurface.getContext('2d');
    fogCtx.fillStyle = COLORS.FOG;
    fogCtx.fillRect(0, 0, WIDTH, HEIGHT);
    fogCtx.globalCompositeOperation = 'destination-out';

    fogCtx.beginPath();
    fogCtx.arc(playerPos[1] * GRID_SIZE + GRID_SIZE / 2, playerPos[0] * GRID_SIZE + 100 + GRID_SIZE / 2, visibility_radius, 0, 2 * Math.PI);
    fogCtx.fill();

    for (let pos of swapPositions) {
      fogCtx.beginPath();
      fogCtx.arc(pos[1] * GRID_SIZE + GRID_SIZE / 2, pos[0] * GRID_SIZE + 100 + GRID_SIZE / 2, GRID_SIZE / 4, 0, 2 * Math.PI);
      fogCtx.fill();
    }

    for (let pos of rotatePositions) {
      fogCtx.beginPath();
      fogCtx.arc(pos[1] * GRID_SIZE + GRID_SIZE / 2, pos[0] * GRID_SIZE + 100 + GRID_SIZE / 2, GRID_SIZE / 4, 0, 2 * Math.PI);
      fogCtx.fill();
    }

    ctx.drawImage(fogSurface, 0, 0);
  };

  const drawCircleWithRectangle = (ctx, rectLeft, rotationAngle, centerPosition) => {
    ctx.save();
    ctx.translate(centerPosition.x, centerPosition.y);
    ctx.rotate((rotationAngle * Math.PI) / 180);
    ctx.fillStyle = COLORS.WHITE;
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = COLORS.BLUE;
    ctx.fillRect(rectLeft ? -60 : 30, -5, 30, 10);
    ctx.restore();
  };

  const handleKeyDown = (event) => {
    const newPos = [...playerPos];
    if (event.key === 'ArrowLeft') {
      newPos[1] = Math.max(0, playerPos[1] - 1);
    } else if (event.key === 'ArrowRight') {
      newPos[1] = Math.min(COLS - 1, playerPos[1] + 1);
    } else if (event.key === 'ArrowUp') {
      newPos[0] = Math.max(0, playerPos[0] - 1);
    } else if (event.key === 'ArrowDown') {
      newPos[0] = Math.min(ROWS - 1, playerPos[0] + 1);
    }

    if (maze[newPos[0]][newPos[1]] in [1, 2, 3]) {
      setPlayerPos(newPos);
      if (maze[newPos[0]][newPos[1]] === 2) {
        setRectLeft(!rectLeft);
        maze[newPos[0]][newPos[1]] = 1;
      } else if (maze[newPos[0]][newPos[1]] === 3) {
        setRotationAngle((rotationAngle + 45) % 360);
        maze[newPos[0]][newPos[1]] = 1;
      }
    }
  };

  return (
    <div>
      <h1>Monkey Maze Demo</h1>
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: '1px solid black' }}></canvas>
      {message && <div style={{ color: COLORS.WHITE, backgroundColor: COLORS.BLACK, padding: '10px' }}>{message}</div>}
    </div>
  );
};

export default MonkeyMazeDemo;
