import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Stage, Layer, Circle, Line, Group, Rect, Text } from 'react-konva';
import seedrandom from 'seedrandom';
import { saveAs } from 'file-saver';
import './ControlPanel.css';

const WIDTH = 500;
const HEIGHT = 700;
const GRID_SIZE = Math.min(WIDTH, HEIGHT - 100) / 7; // 7 original
//const ROWS = 7;
//const COLS = 7;
const CIRCLE_RADIUS = GRID_SIZE / 4; 
const TOTAL_TRIALS = 10;
const FOG_COLOR = 'rgba(0, 0, 0, 1)';
const visibilityRadius = 63; // visibility radius; 20 is full circle, 70 is next circle 

const getNeighbors = (pos) => [
  [pos[0] - 1, pos[1]], // up
  [pos[0] + 1, pos[1]], // down
  [pos[0], pos[1] - 1], // left
  [pos[0], pos[1] + 1]  // right
];

const isValid = (maze, pos, ROWS = 7, COLS = 7) => (
  pos[0] >= 0 && pos[0] < ROWS && pos[1] >= 0 && pos[1] < COLS && maze[pos[0]][pos[1]] !== 0
);

const generateMaze = (nodeDetails, connectivity_sparsity = 0.2, maze_seed = "Maze",  
                      operation_node_seed = null, mazeStructure = null, 
                      fullyConnected = true, ROWS = 7, COLS = 7, numGoalPositions=2) => {
  console.log("Starting maze generation...");
  while (true) {
    console.log("Generating new maze attempt...");
    var maze = mazeStructure 
      ? mazeStructure.map(row => row.slice()) 
      : Array.from({ length: ROWS }, () => Array(COLS).fill(1));
    const adjMatrix = Array.from({ length: ROWS * COLS }, () => Array(ROWS * COLS).fill(0));

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        for (let neighbor of getNeighbors([row, col])) {
          if (isValidMatrixIndex(neighbor, ROWS, COLS) && maze[row][col] !== 0 && maze[neighbor[0]][neighbor[1]] !== 0) {
            adjMatrix[row * COLS + col][neighbor[0] * COLS + neighbor[1]] = 1;
          }
        }
      }
    }


    const start = nodeDetails.start.positions[0]
    const goals = nodeDetails.goal.positions;

    if (fullyConnected) {
      removeEdgesOnly(maze, adjMatrix, start, goals, connectivity_sparsity, maze_seed, ROWS, COLS)
      ensureFullConnectivity(maze, adjMatrix, ROWS, COLS); // Ensure full connectivity after edge removal
      console.log("The adj matrix at generation", adjMatrix);
    }
    else { 
      removeEdgesOrNodes(maze, adjMatrix, start, goals, connectivity_sparsity, maze_seed, ROWS, COLS);
      removeIsolatedNodes(maze, adjMatrix, ROWS, COLS);
      removeInvalidEdges(maze, adjMatrix, ROWS, COLS);
      removeUnreachableNodes(maze, adjMatrix, start, ROWS, COLS);
      
      // Ensure connectivity for all goal positions
      ensureConnectivity(maze, adjMatrix, [start, ...goals]);
      removeInvalidEdges(maze, adjMatrix, ROWS, COLS);
    }
    
    // Update maze with names from nodeDetails 
    var maze = updateMazeWithNodeNames(maze, nodeDetails, false) 

    // Update node details with placed positions
    Object.keys(nodeDetails.operation).forEach(key => {
      const operation = nodeDetails.operation[key];
      operation.positions = placeOperationNodes(maze, 
                                                operation.quantity, 
                                                operation.mazeName, 
                                                operation.predefinedPositions, 
                                                operation_node_seed);
      });


    // Check connectivity for all goal positions
    if (goals.every(goal => bfs(maze, adjMatrix, start, goal, ROWS, COLS))) {
      nodeDetails.start.positions = [start];
      nodeDetails.goal.positions = goals;
      return { maze, nodeDetails, adjMatrix };
    }

  }
};

const getRandomPositions = (numPositions, rows, cols) => {
  const positions = [];
  for (let i = 0; i < numPositions; i++) {
    const x = Math.floor(Math.random() * cols);
    const y = Math.floor(Math.random() * rows);
    positions.push({ x, y });
  }
  return positions;
};


const removeEdgesOnly = (maze, adjMatrix, start, goals, removalProb, seed = null, ROWS=7, COLS=7) => {
  const rng = seed ? seedrandom(seed) : Math.random;
  const edgeList = [];

  // Collect all edges
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const currentIdx = row * COLS + col;
      for (let neighbor of getNeighbors([row, col])) {
        if (isValidMatrixIndex(neighbor, ROWS, COLS)) {
          const neighborIdx = neighbor[0] * COLS + neighbor[1];
          if (adjMatrix[currentIdx][neighborIdx] === 1) {
            edgeList.push([currentIdx, neighborIdx]);
          }
        }
      }
    }
  }

  // Shuffle edges
  for (let i = edgeList.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [edgeList[i], edgeList[j]] = [edgeList[j], edgeList[i]];
  }

  // Attempt to remove edges based on removalProb
  for (let [currentIdx, neighborIdx] of edgeList) {
    if (rng() < removalProb) {
      adjMatrix[currentIdx][neighborIdx] = 0;
      adjMatrix[neighborIdx][currentIdx] = 0;

      // Check if the graph is still fully connected
      if (!isGraphConnected(adjMatrix, ROWS, COLS)) {
        adjMatrix[currentIdx][neighborIdx] = 1;
        adjMatrix[neighborIdx][currentIdx] = 1;
      }
    }
  }
};

const isGraphConnected = (adjMatrix, ROWS, COLS) => {
  const visited = new Array(ROWS * COLS).fill(false);
  const queue = [0]; // Start from the first node
  visited[0] = true;
  let count = 1;

  while (queue.length > 0) {
    const node = queue.shift();
    for (let neighbor = 0; neighbor < adjMatrix[node].length; neighbor++) {
      if (adjMatrix[node][neighbor] === 1 && !visited[neighbor]) {
        visited[neighbor] = true;
        queue.push(neighbor);
        count++;
      }
    }
  }

  // Check if all nodes were visited
  return count === ROWS * COLS;
};

const ensureFullConnectivity = (maze, adjMatrix, ROWS, COLS) => {
  // Helper function to find connected components using BFS
  const findConnectedComponents = () => {
    const visited = new Array(ROWS * COLS).fill(false);
    const components = [];

    for (let i = 0; i < ROWS; i++) {
      for (let j = 0; j < COLS; j++) {
        const startIdx = i * COLS + j;
        if (!visited[startIdx] && maze[i][j] !== 0) {
          const component = [];
          const queue = [[i, j]];
          visited[startIdx] = true;
          while (queue.length > 0) {
            const [x, y] = queue.shift();
            component.push([x, y]);
            for (const [nx, ny] of getNeighbors([x, y])) {
              const neighborIdx = nx * COLS + ny;
              if (isValid(maze, [nx, ny], ROWS, COLS) && !visited[neighborIdx]) {
                visited[neighborIdx] = true;
                queue.push([nx, ny]);
              }
            }
          }
          components.push(component);
        }
      }
    }
    return components;
  };

  const components = findConnectedComponents();
  if (components.length <= 1) return; // Already fully connected

  // Connect all components
  for (let i = 1; i < components.length; i++) {
    const componentA = components[i - 1];
    const componentB = components[i];

    let minDist = Infinity;
    let bestPair = null;

    for (const [ax, ay] of componentA) {
      for (const [bx, by] of componentB) {
        const dist = Math.abs(ax - bx) + Math.abs(ay - by);
        if (dist < minDist) {
          minDist = dist;
          bestPair = [[ax, ay], [bx, by]];
        }
      }
    }

    if (bestPair) {
      const [[ax, ay], [bx, by]] = bestPair;
      if (ax === bx) {
        for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) {
          maze[ax][y] = 1;
          updateAdjacencyMatrix(adjMatrix, [ax, y], false, ROWS, COLS);
        }
      } else if (ay === by) {
        for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) {
          maze[x][ay] = 1;
          updateAdjacencyMatrix(adjMatrix, [x, ay], false, ROWS, COLS);
        }
      } else {
        let [x, y] = [ax, ay];
        while (x !== bx || y !== by) {
          maze[x][y] = 1;
          updateAdjacencyMatrix(adjMatrix, [x, y], false, ROWS, COLS);
          if (x !== bx) x += x < bx ? 1 : -1;
          else y += y < by ? 1 : -1;
        }
      }
    }
  }
};


const cropAndAdjustMaze = (maze, adjMatrix, nodeDetails, [x1, y1, x2, y2], ROWS, COLS) => {
  // Create the cropped maze
  const croppedMaze = maze.map((row, rowIndex) => 
    row.map((value, colIndex) => {
      if (rowIndex >= y1 && rowIndex <= y2 && colIndex >= x1 && colIndex <= x2) {
        return value !== 0 ? 1 : 0;
      }
      return null;
    })
  );

  // Mark nodes outside the crop area as inactive in the adjacency matrix
  const markInactiveNodes = (adjMatrix, x1, y1, x2, y2, ROWS, COLS) => {
    const newAdjMatrix = adjMatrix.map(row => row.slice());
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col;
        if (row < y1 || row > y2 || col < x1 || col > x2) {
          for (let i = 0; i < ROWS * COLS; i++) {
            newAdjMatrix[idx][i] = 0;
            newAdjMatrix[i][idx] = 0;
          }
        }
      }
    }
    return newAdjMatrix;
  };

  let updatedAdjMatrix = markInactiveNodes(adjMatrix, x1, y1, x2, y2, ROWS, COLS);

  // Helper function to get all connected nodes from a given start node
  const getAllConnectedNodes = (startNode, adjMatrix, x1, y1, x2, y2, COLS) => {
    const visited = new Set();
    const queue = [startNode];
    const [startRow, startCol] = startNode;
    const startIdx = (startRow - y1) * COLS + (startCol - x1);
    visited.add(startIdx);

    while (queue.length > 0) {
      const [row, col] = queue.shift();
      const currentIdx = (row - y1) * COLS + (col - x1);

      for (let neighbor of getNeighbors([row, col])) {
        const [nRow, nCol] = neighbor;
        if (nRow >= y1 && nRow <= y2 && nCol >= x1 && nCol <= x2) {
          const neighborIdx = (nRow - y1) * COLS + (nCol - x1);
          if (adjMatrix[currentIdx][neighborIdx] === 1 && !visited.has(neighborIdx)) {
            visited.add(neighborIdx);
            queue.push(neighbor);
          }
        }
      }
    }

    return visited;
  };

  // Ensure all nodes within the cropped area are connected
  const ensureFullConnectivity = (adjMatrix, x1, y1, x2, y2, ROWS, COLS) => {
    const startNode = [y1, x1];
    let connectedNodes = getAllConnectedNodes(startNode, adjMatrix, x1, y1, x2, y2, COLS);

    for (let row = y1; row <= y2; row++) {
      for (let col = x1; col <= x2; col++) {
        const nodeIdx = (row - y1) * COLS + (col - x1);
        if (!connectedNodes.has(nodeIdx) && croppedMaze[row - y1][col - x1] === 1) {
          // Find a neighbor to connect the isolated node
          for (let neighbor of getNeighbors([row, col])) {
            const [nRow, nCol] = neighbor;
            if (nRow >= y1 && nRow <= y2 && nCol >= x1 && nCol <= x2) {
              const neighborIdx = (nRow - y1) * COLS + (nCol - x1);
              if (connectedNodes.has(neighborIdx) && croppedMaze[nRow - y1][nCol - x1] === 1) {
                adjMatrix[nodeIdx][neighborIdx] = 1;
                adjMatrix[neighborIdx][nodeIdx] = 1;
                connectedNodes = getAllConnectedNodes(startNode, adjMatrix, x1, y1, x2, y2, COLS);
                break;
              }
            }
          }
        }
      }
    }
  };

  ensureFullConnectivity(updatedAdjMatrix, x1, y1, x2, y2, ROWS, COLS);

  // Check if start positions are within the crop range
  if (
    nodeDetails.start.positions[0][0] < y1 || nodeDetails.start.positions[0][0] > y2 ||
    nodeDetails.start.positions[0][1] < x1 || nodeDetails.start.positions[0][1] > x2
  ) {
    // Find all available positions
    const availablePositions = [];
    for (let row = y1; row <= y2; row++) {
      for (let col = x1; col <= x2; col++) {
        if (croppedMaze[row - y1][col - x1] === 1) {
          availablePositions.push([row - y1, col - x1]);
        }
      }
    }

    // Choose the most top-left position for the start
    const start = availablePositions.reduce((prev, curr) => 
      (prev[0] + prev[1] < curr[0] + curr[1]) ? prev : curr
    );
    nodeDetails.start.positions = [start];
  }

  // Check if goal positions are within the crop range
  nodeDetails.goal.positions = nodeDetails.goal.positions.map((pos, index) => {
    if (pos[0] < y1 || pos[0] > y2 || pos[1] < x1 || pos[1] > x2) {
      // Find all available positions
      const availablePositions = [];
      for (let row = y1; row <= y2; row++) {
        for (let col = x1; col <= x2; col++) {
          if (croppedMaze[row - y1][col - x1] === 1) {
            availablePositions.push([row - y1, col - x1]);
          }
        }
      }

      // Choose the most bottom-right position for the first goal if it's not within crop range
      const goal = availablePositions.reduce((prev, curr) => 
        (prev[0] + prev[1] > curr[0] + curr[1]) ? prev : curr
      );
      availablePositions.splice(availablePositions.findIndex(p => p[0] === goal[0] && p[1] === goal[1]), 1);

      // Place remaining goals in random available positions
      while (nodeDetails.goal.positions.length < nodeDetails.goal.positions.length && availablePositions.length > 0) {
        const randomIndex = Math.floor(Math.random() * availablePositions.length);
        nodeDetails.goal.positions.push(availablePositions.splice(randomIndex, 1)[0]);
      }

      return goal;
    }
    return pos;
  });

  // Update maze with names from nodeDetails
  const updatedCroppedMaze = updateMazeWithNodeNames(croppedMaze, nodeDetails);

  console.log("The maze", updatedCroppedMaze);
  console.log("The adj matrix", updatedAdjMatrix);
  return { croppedMaze: updatedCroppedMaze, croppedAdjMatrix: updatedAdjMatrix, nodeDetails };
};

const updateMazeWithNodeNames = (maze, nodeDetails, operations=false) => {
  const updatedMaze = maze.map(row => row.slice()); // Deep copy the maze

  // Update start position in the maze
  const start = nodeDetails.start.positions[0];
  if (start) {
    const [startRow, startCol] = start;
    if (startRow < maze.length && startCol < maze[0].length) {
      updatedMaze[startRow][startCol] = "s";
    }
  }

  // Update goal positions in the maze
  const goals = nodeDetails.goal.positions;
  goals.forEach(goal => {
    const [goalRow, goalCol] = goal;
    if (goalRow < maze.length && goalCol < maze[0].length) {
      updatedMaze[goalRow][goalCol] = "g";
    }
  });

  // Update operation positions in the maze
  if (operations) {
    Object.keys(nodeDetails.operation).forEach(key => {
      const operation = nodeDetails.operation[key];
      const positions = operation.positions;
      positions.forEach(pos => {
        const [opRow, opCol] = pos;
        if (opRow < maze.length && opCol < maze[0].length) {
          updatedMaze[opRow][opCol] = operation.mazeName;
        }
      });
    });
  }

  return updatedMaze;
};



const placeOperationNodes = (maze, numNodes, nodeType, predefinedPositions = null, seed = null) => {
  const rng = seed ? seedrandom(seed) : Math.random;
  const positions = [];
  const numRows = maze.length;
  const numCols = maze[0].length;
  

  // Check and place predefined positions first.
  // This populates the positions array either fully or partly
  if (predefinedPositions && predefinedPositions.length > 0) {
    for (let pos of predefinedPositions) {
      const [x, y] = pos;
      if (x >= 0 && x < numRows && y >= 0 && y < numCols && maze[x][y] === 1) {
        maze[x][y] = nodeType;
        positions.push([x, y]);
        if (positions.length >= numNodes) {
          break;
        }
      }
    }
  }

  // Gather all available positions in the maze
  const availablePositions = [];
  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      if (maze[row][col] === 1) {
        availablePositions.push([row, col]);
      }
    }
  }

  // Randomly place remaining nodes if needed,
  // if the numNodes are larger than the length of the position array
  while (positions.length < numNodes && availablePositions.length > 0) {
    const randomIndex = Math.floor(rng() * availablePositions.length);
    const [x, y] = availablePositions.splice(randomIndex, 1)[0];
    maze[x][y] = nodeType;
    positions.push([x, y]);
  }

  return positions;
};


const ensureConnectivity = (maze, adjMatrix, criticalNodes) => {
  for (let i = 0; i < criticalNodes.length - 1; i++) {
    for (let j = i + 1; j < criticalNodes.length; j++) {
      ensurePath(maze, adjMatrix, criticalNodes[i], criticalNodes[j]);
    }
  }
};

const removeEdgesOrNodes = (maze, adjMatrix, start, goals, removalProb, seed = null, ROWS=7, COLS=7) => {
    const rng = seed ? seedrandom(seed) : Math.random;
  
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (rng() < removalProb) {
          const currentIdx = row * COLS + col;
          for (let neighbor of getNeighbors([row, col])) {
            if (isValidMatrixIndex(neighbor, ROWS, COLS)) {
              const neighborIdx = neighbor[0] * COLS + neighbor[1];
              if (adjMatrix[currentIdx][neighborIdx] === 1) {
                adjMatrix[currentIdx][neighborIdx] = 0;
                adjMatrix[neighborIdx][currentIdx] = 0;

                //if (!bfs(maze, adjMatrix, start, goal)) {
                if (goals.every(goal => !bfs(maze, adjMatrix, start, goal, ROWS, COLS))){
                  adjMatrix[currentIdx][neighborIdx] = 1;
                  adjMatrix[neighborIdx][currentIdx] = 1;
                }
              }
            }
          }
        }
      }
    }
  };

const removeIsolatedNodes = (maze, adjMatrix, ROWS=7, COLS=7) => {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const currentIdx = row * COLS + col;
      if (adjMatrix[currentIdx].reduce((a, b) => a + b) === 0) {
        maze[row][col] = 0;
      }
    }
  }
};

const removeInvalidEdges = (maze, adjMatrix, ROWS=7, COLS=7) => {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const currentIdx = row * COLS + col;
        let validNeighborExists = false;
  
        // Check if current node has any valid neighbors
        for (let neighbor of getNeighbors([row, col])) {
          if (isValid(maze, neighbor, ROWS, COLS)) {
            validNeighborExists = true;
            break;
          }
        }
  
        // If no valid neighbors exist, remove all edges for this node
        if (!validNeighborExists) {
          for (let i = 0; i < ROWS * COLS; i++) {
            adjMatrix[currentIdx][i] = 0;
            adjMatrix[i][currentIdx] = 0;
          }
        } else {
          // Otherwise, remove only invalid edges
          for (let neighbor of getNeighbors([row, col])) {
            if (!isValid(maze, neighbor, ROWS, COLS)) {
              const neighborIdx = neighbor[0] * COLS + neighbor[1];
              if (isValidMatrixIndex([row, col], ROWS, COLS) && isValidMatrixIndex(neighbor, ROWS, COLS)) {
                adjMatrix[currentIdx][neighborIdx] = 0;
                adjMatrix[neighborIdx][currentIdx] = 0;
              }
            }
          }
        
          // Check if there are any edges leading to nowhere and remove them
          for (let i = 0; i < ROWS * COLS; i++) {
            if (adjMatrix[currentIdx][i] === 1) {
              const targetRow = Math.floor(i / COLS);
              const targetCol = i % COLS;
              if (!isValid(maze, [targetRow, targetCol], ROWS, COLS)) {
                adjMatrix[currentIdx][i] = 0;
                adjMatrix[i][currentIdx] = 0;
              }
            }
          }
        }
      }
    }
  };

const removeUnreachableNodes = (maze, adjMatrix, start, ROWS=7, COLS=7) => {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const currentIdx = row * COLS + col;
      if (![...start].includes(currentIdx) && !bfsCheck(maze, adjMatrix, [row, col], start)) {
        for (let neighbor of getNeighbors([row, col])) {
          if (isValidMatrixIndex(neighbor, ROWS, COLS)) {
            const neighborIdx = neighbor[0] * COLS + neighbor[1];
            adjMatrix[currentIdx][neighborIdx] = 0;
            adjMatrix[neighborIdx][currentIdx] = 0;
          }
        }
        maze[row][col] = 0;
      }
    }
  }
};

const isValidMatrixIndex = (pos, ROWS=7, COLS=7) => 0 <= pos[0] && pos[0] < ROWS && 0 <= pos[1] && pos[1] < COLS;

const bfsCheck = (maze, adjMatrix, start, goal, ROWS=7, COLS=7) => {
  const q = [];
  const visited = new Set();
  q.push(start);
  visited.add(start.toString());

  while (q.length > 0) {
    const current = q.shift();
    if (current.toString() === goal.toString()) return true;
    for (let neighbor of getNeighbors(current)) {
      if (isValidMatrixIndex(neighbor, ROWS, COLS)) {
        const currentIdx = current[0] * COLS + current[1];
        const neighborIdx = neighbor[0] * COLS + neighbor[1];
        if (adjMatrix[currentIdx][neighborIdx] === 1 && !visited.has(neighbor.toString())) {
          visited.add(neighbor.toString());
          q.push(neighbor);
        }
      }
    }
  }
  return false;
};

const bfs = (maze, adjMatrix, start, goal, ROWS=7, COLS=7) => {
  const bfsDirection = (maze, adjMatrix, start, goal) => {
    const q = [];
    const visited = new Set();
    q.push(start);
    visited.add(start.toString());

    while (q.length > 0) {
      const current = q.shift();
      if (current.toString() === goal.toString()) return true;
      for (let neighbor of getNeighbors(current)) {
        if (isValid(maze, neighbor, ROWS, COLS) && !visited.has(neighbor.toString())) {
          visited.add(neighbor.toString());
          q.push(neighbor);
        }
      }
    }
    return false;
  };

  return bfsDirection(maze, adjMatrix, start, goal) //&& bfsDirection(maze, adjMatrix, goal, start);
};

const ensurePath = (maze, adjMatrix, start, goal, ROWS=7, COLS=7) => {
  if (!bfs(maze, adjMatrix, start, goal, ROWS, COLS)) {
    const path = generatePath(maze, start, goal, ROWS, COLS);
    for (let pos of path) {
      maze[pos[0]][pos[1]] = 1;
    }
    updateAdjacencyMatrix(adjMatrix, start);
    updateAdjacencyMatrix(adjMatrix, goal);
  }
};

const updateAdjacencyMatrix = (adjMatrix, pos, remove = false, ROWS=7, COLS=7) => {
  const index = pos[0] * COLS + pos[1];
  for (let neighbor of getNeighbors(pos)) {
    const neighborIdx = neighbor[0] * COLS + neighbor[1];
    if (isValidMatrixIndex(neighbor, ROWS, COLS)) {
      if (remove) {
        adjMatrix[index][neighborIdx] = 0;
        adjMatrix[neighborIdx][index] = 0;
      } else {
        adjMatrix[index][neighborIdx] = 1;
        adjMatrix[neighborIdx][index] = 1;
      }
    }
  }
};

const generatePath = (maze, start, goal, ROWS, COLS) => {
  const q = [];
  const visited = new Set();
  q.push([start, [start]]);

  while (q.length > 0) {
    const [current, path] = q.shift();
    if (current.toString() === goal.toString()) return path;
    for (let neighbor of getNeighbors(current)) {
      if (isValid(maze, neighbor, ROWS, COLS) && !visited.has(neighbor.toString())) {
        visited.add(neighbor.toString());
        q.push([neighbor, path.concat([neighbor])]);
      }
    }
  }
  return [];
};

const getAllConnectedNodes = (node, adjMatrix, ROWS, COLS) => {
  const [row, col] = node;
  const currentIdx = row * COLS + col;
  const connectedNodes = [];

  for (let i = 0; i < ROWS * COLS; i++) {
    if (adjMatrix[currentIdx][i] === 1) {
      const neighborRow = Math.floor(i / COLS);
      const neighborCol = i % COLS;
      connectedNodes.push([neighborRow, neighborCol]);
    }
  }

  return connectedNodes;
};  


const picture = {
  elements: [
    {
      shape: 'circle',
      radius: 30,
      color: 'white',
      x: WIDTH / 2 - 150,
      y: 50,
      offsetX: 0,
      offsetY: 0,
    },
    {
      shape: 'rect',
      width: 30,
      height: 10.5,
      color: '#1700ff',
      offsetX: 0,
      offsetY: 5,
      rotationAngle: 45,
      x: WIDTH / 2 - 150,
      y: 50,
    },
    {
      shape: 'rect',
      width: 30,
      height: 10.5,
      color: '#3ba6ff',
      offsetX: 0,
      offsetY: 5,
      rotationAngle: 0,
      x: WIDTH / 2 - 150,
      y: 50,
    }
  ]
};

const drawMaze = (maze, adjMatrix, picture, goalPicture, nodeDetails, colorMap,
                  hideEdges = false, 
                  showAllNodes = false, 
                  edgesOnTopOfNodes = false,
                  edgeWidth = 20,
                  nodeAndEdges = true,
                  wallColor = ['cyan', 'black', 'black', 'black'], // Default wall colors
                  borderWidth = 5,
                  nodeSize = CIRCLE_RADIUS,
                  GRID_SIZE = GRID_SIZE,
                  ROWS=7, COLS=7, 
                  pictureVisibility,
                  goalPictureVisibility,

) => {
  
                    const elements = [];
  const goalPictureOffsetX = WIDTH / 2 + 150;

  // Function to draw nodes
  const drawNodes = (colorOverride = null, nodeSize = nodeSize, condition = () => true, drawOrder = 0) => {
    if (!colorMap) {
      console.error("colorMap is not defined");
      return;
    }

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const nodeValue = maze[row][col];
        if (nodeValue === undefined || nodeValue === null) {
          continue;
        }

        let nodeColor;
        let nodeDetailsEntry = Object.values(nodeDetails).find(node => node.mazeName == nodeValue);

        if (colorOverride) {
          nodeColor = colorOverride;
        } else if (nodeValue in colorMap) {
          if (nodeDetailsEntry) {
            const positionIndex = nodeDetailsEntry.positions.findIndex(pos => pos[0] === row && pos[1] === col);
            if (positionIndex !== -1) {
              nodeColor = Array.isArray(nodeDetailsEntry.color) ? nodeDetailsEntry.color[positionIndex] : nodeDetailsEntry.color;
            } else {
              nodeColor = colorMap[nodeValue][0]; // Use the first color if the position is not specifically indexed
            }
          } else {
            nodeColor = Array.isArray(colorMap[nodeValue]) ? colorMap[nodeValue][0] : colorMap[nodeValue]; // Default to the first color in array if any
          }
        } else {
          nodeColor = showAllNodes ? 'white' : null;
        }

        if (nodeColor && condition(nodeValue)) {
          // Use nodeValue, row-col combination, and drawOrder to generate a more unique key
          const key = `node-${nodeValue}-${row}-${col}-${drawOrder}`;
          if (nodeAndEdges) {
            elements.push(
              <Circle
                key={key}
                x={col * GRID_SIZE + GRID_SIZE / 2}
                y={row * GRID_SIZE + GRID_SIZE / 2 + 100}
                radius={nodeSize}
                fill={nodeColor}
              />
            );
          } else {
            elements.push(
              <Rect
                key={key}
                x={col * GRID_SIZE + GRID_SIZE / 3.9 - nodeSize}
                y={row * GRID_SIZE + GRID_SIZE / 3.9 + 100 - nodeSize}
                width={nodeSize * 3.9}
                height={nodeSize * 3.9}
                fill={nodeColor}
              />
            );
          }
        }
      }
    }
  };
  
  // Function to draw edges
  const drawEdges = () => {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (!hideEdges) {
          const connectedNodes = getAllConnectedNodes([row, col], adjMatrix, ROWS, COLS);
          for (let neighbor of connectedNodes) {
            if (isValidMatrixIndex(neighbor, ROWS, COLS)) {
              elements.push(
                <Line
                  key={`edge-${row}-${col}-${neighbor[0]}-${neighbor[1]}`}
                  points={[
                    col * GRID_SIZE + GRID_SIZE / 2, row * GRID_SIZE + GRID_SIZE / 2 + 100,
                    neighbor[1] * GRID_SIZE + GRID_SIZE / 2, neighbor[0] * GRID_SIZE + GRID_SIZE / 2 + 100
                  ]}
                  stroke="grey"
                  strokeWidth={edgeWidth}
                />
              );
            }
          }
        }
      }
    }
  };

  // Function to draw the border
  const drawBorder = () => {
    const top = [
      { x: 0, y: 100 },
      { x: COLS * GRID_SIZE, y: 100 }
    ];
    const bottom = [
      { x: 0, y: ROWS * GRID_SIZE + 100 },
      { x: COLS * GRID_SIZE, y: ROWS * GRID_SIZE + 100 }
    ];
    const left = [
      { x: 0, y: 100 },
      { x: 0, y: ROWS * GRID_SIZE + 100 }
    ];
    const right = [
      { x: COLS * GRID_SIZE, y: 100 },
      { x: COLS * GRID_SIZE, y: ROWS * GRID_SIZE + 100 }
    ];

    elements.push(
      <Line key="border-top" points={top.flatMap(point => [point.x, point.y])} stroke={wallColor[0]} strokeWidth={borderWidth} />,
      <Line key="border-bottom" points={bottom.flatMap(point => [point.x, point.y])} stroke={wallColor[1]} strokeWidth={borderWidth} />,
      <Line key="border-left" points={left.flatMap(point => [point.x, point.y])} stroke={wallColor[2]} strokeWidth={borderWidth} />,
      <Line key="border-right" points={right.flatMap(point => [point.x, point.y])} stroke={wallColor[3]} strokeWidth={borderWidth} />
    );
  };

   // Draw elements based on EdgesOnTopOfNodes flag
   if (edgesOnTopOfNodes) {
    if (!showAllNodes) {
      drawNodes('white', nodeSize*0.9, undefined, 0); // Draw all nodes in white first if showAllNodes is false
      drawNodes('black', nodeSize, value => value === 0, 1); // Draw nodes with value 0 as black
    }
    drawNodes(null, nodeSize, value => value !== null && value !== 0, 2); // Draw real color nodes
    drawEdges();
  } else {
    drawEdges();
    if (!showAllNodes) {
      drawNodes('white', nodeSize*0.9, undefined, 0); // Draw all nodes in white first if showAllNodes is false
      drawNodes('black', nodeSize, value => value === 0, 1); // Draw nodes with value 0 as black
    }
    drawNodes(null, nodeSize, value => value !== null && value !== 0, 2); // Draw real color nodes
  }

  drawBorder(); // Draw the border after nodes and edges


  // Function to draw an element based on the given properties
  const drawElement = (element, keyPrefix) => {
    if (element.shape === 'circle') {
      return (
        <Circle
          key={`${keyPrefix}-${element.shape}`}
          radius={element.radius}
          fill={element.color}
          x={element.x}
          y={element.y}
          offsetX={element.offsetX}
          offsetY={element.offsetY}
        />
      );
    } else if (element.shape === 'rect') {
      return (
        <Rect
          key={`${keyPrefix}-${element.shape}`}
          width={element.width}
          height={element.height}
          fill={element.color}
          offsetX={element.offsetX}
          offsetY={element.offsetY}
          rotation={element.rotationAngle}
          x={element.x}
          y={element.y}
        />
      );
    }
    return null;
  };

  // Draw elements for the current picture
  if (pictureVisibility) {
    picture.elements.forEach((element, index) => {
      elements.push(drawElement(element, `currentPicture-${index}`));
    });
  }

  // Draw elements for the goal picture with specified offset
  if (goalPictureVisibility) {
    goalPicture.elements.forEach((element, index) => {
      const goalElement = {
        ...element,
        x: goalPictureOffsetX // Offset the x position to the right
      };
      elements.push(drawElement(goalElement, `goalPicture-${index}`));
    });
  }

  return elements;
};

const drawFog = (
  playerPos, nodeDetails, 
  goalPicturePosition, currentPicturePosition, 
  showAllNodes = false, showGoal = true, 
  showOperations = true, showStart = true, 
  showCurrentPicture = true, showGoalPicture = true,
  nodeAndEdges = true,
  visibilityRadius = 63, 
  visibilityRadiusNode = 0.25,
  visibilityRadiusPicture = 0.5,
  CIRCLE_RADIUS = GRID_SIZE / 4,
  ROWS = 7,
  COLS = 7


) => {
  const visibilityRadiusNodes = GRID_SIZE * visibilityRadiusNode;
  const visibilityRadiusPictures = GRID_SIZE * visibilityRadiusPicture;

  return (
    <Rect
      x={0}
      y={0}
      width={WIDTH}
      height={HEIGHT}
      fill={FOG_COLOR}
      sceneFunc={(ctx, shape) => {
        // Draw the fog
        ctx.fillStyle = FOG_COLOR;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        // Set the global composite operation to destination-out to create holes
        ctx.globalCompositeOperation = 'destination-out';

        // Draw clear circle around the player
        if (nodeAndEdges) {
          ctx.beginPath();
          ctx.arc(playerPos[1] * GRID_SIZE + GRID_SIZE / 2, playerPos[0] * GRID_SIZE + GRID_SIZE / 2 + 100, visibilityRadius, 0, Math.PI * 2, true);
          ctx.fill();
        } else {
          ctx.clearRect(
            playerPos[1] * GRID_SIZE + GRID_SIZE / 3.9 - CIRCLE_RADIUS,
            playerPos[0] * GRID_SIZE + GRID_SIZE / 3.9 + 100 - CIRCLE_RADIUS,
            CIRCLE_RADIUS * 3.9,
            CIRCLE_RADIUS * 3.9
          );
          ctx.arc(playerPos[1] * GRID_SIZE + GRID_SIZE / 2, playerPos[0] * GRID_SIZE + GRID_SIZE / 2 + 100, visibilityRadius, 0, Math.PI * 2, true);
          ctx.fill();
        }

        // Draw clear circles or squares around all nodes if showAllNodes is true
        if (showAllNodes) {
          for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
              if (nodeAndEdges) {
                ctx.beginPath();
                ctx.arc(col * GRID_SIZE + GRID_SIZE / 2, row * GRID_SIZE + GRID_SIZE / 2 + 100, visibilityRadiusNodes, 0, Math.PI * 2, true);
                ctx.fill();
              } else {
                ctx.clearRect(
                  col * GRID_SIZE + GRID_SIZE / 3.9 - CIRCLE_RADIUS,
                  row * GRID_SIZE + GRID_SIZE / 3.9 + 100 - CIRCLE_RADIUS,
                  CIRCLE_RADIUS * 3.9,
                  CIRCLE_RADIUS * 3.9
                );
              }
            }
          }
        }
        if (showStart) {
          // Draw clear circle or square around the start position
          nodeDetails.start.positions.forEach(pos => {
            if (nodeAndEdges) {
              ctx.beginPath();
              ctx.arc(pos[1] * GRID_SIZE + GRID_SIZE / 2, pos[0] * GRID_SIZE + GRID_SIZE / 2 + 100, visibilityRadiusNodes + 2, 0, Math.PI * 2, true);
              ctx.fill();
            } else {
              ctx.clearRect(
                pos[1] * GRID_SIZE + GRID_SIZE / 3.9 - CIRCLE_RADIUS,
                pos[0] * GRID_SIZE + GRID_SIZE / 3.9 + 100 - CIRCLE_RADIUS,
                CIRCLE_RADIUS * 3.9,
                CIRCLE_RADIUS * 3.9
              );
            }
          });
        }
        if (showGoal) {
          // Draw clear circle or square around the goal position
          nodeDetails.goal.positions.forEach(pos => {
            if (nodeAndEdges) {
              ctx.beginPath();
              ctx.arc(pos[1] * GRID_SIZE + GRID_SIZE / 2, pos[0] * GRID_SIZE + GRID_SIZE / 2 + 100, visibilityRadiusNodes + 2, 0, Math.PI * 2, true);
              ctx.fill();
            } else {
              ctx.clearRect(
                pos[1] * GRID_SIZE + GRID_SIZE / 3.9 - CIRCLE_RADIUS,
                pos[0] * GRID_SIZE + GRID_SIZE / 3.9 + 100 - CIRCLE_RADIUS,
                CIRCLE_RADIUS * 3.9,
                CIRCLE_RADIUS * 3.9
              );
            }
          });
        }
        if (showOperations) {
          // Draw clear circles or squares around all operation node positions
          Object.values(nodeDetails.operation).forEach(node => {
            node.positions.forEach(pos => {
              if (nodeAndEdges) {
                ctx.beginPath();
                ctx.arc(pos[1] * GRID_SIZE + GRID_SIZE / 2, pos[0] * GRID_SIZE + GRID_SIZE / 2 + 100, visibilityRadiusNodes, 0, Math.PI * 2, true);
                ctx.fill();
              } else {
                ctx.clearRect(
                  pos[1] * GRID_SIZE + GRID_SIZE / 3.9 - CIRCLE_RADIUS,
                  pos[0] * GRID_SIZE + GRID_SIZE / 3.9 + 100 - CIRCLE_RADIUS,
                  CIRCLE_RADIUS * 3.9,
                  CIRCLE_RADIUS * 3.9
                );
              }
            });
          });
        }
        if (showGoalPicture) {
          // Draw clear circle around the goal picture position
          ctx.beginPath();
          ctx.arc(goalPicturePosition[0], goalPicturePosition[1], visibilityRadiusPictures, 0, Math.PI * 2, true);
          ctx.fill();
        }
        if (showCurrentPicture) {
          // Draw clear circle around the current picture position
          ctx.beginPath();
          ctx.arc(currentPicturePosition[0], currentPicturePosition[1], visibilityRadiusPictures, 0, Math.PI * 2, true);
          ctx.fill();
        }
        // Reset the composite operation to source-over
        ctx.globalCompositeOperation = 'source-over';
      }}
    />
  );
};



// Operations

// Rotate the specified rectangle element within the picture by 45 degrees
const rotateRect45 = (picture, elementIndex) => {
  const element = picture.elements[elementIndex];
  element.rotationAngle = (element.rotationAngle + 45) % 360;
};

// Rotate the specified rectangle element within the picture by 180 degrees
const rotateRect180 = (picture, elementIndex) => {
  const element = picture.elements[elementIndex];
  element.rotationAngle = (element.rotationAngle + 180) % 360;
};

// Swap the rect_left property of the specified element within the picture
const swap = (picture, elementIndex) => {
  const element = picture.elements[elementIndex];
  element.rect_left = !element.rect_left;
};

// Move goal position
const moveGoalNode = (maze, goalPos, newPos, ROWS=7, COLS=7) => {
  if (!isValidMatrixIndex(newPos, ROWS, COLS)) {
    throw new Error("The proposed goal position is out of bounds");
  }

  if (maze[newPos[0]][newPos[1]] === 0) {
    throw new Error("The new position is an isolated node");
  }

  // Remove the goal node from the old position
  maze[goalPos[0]][goalPos[1]] = 1;

  // Place the goal node at the new position
  goalPos = [...newPos];

  return goalPos;
};

// Example usage of rotateMaze90Degrees remains unchanged
const rotateMaze90Degrees = (maze, swapPositions, rotatePositions, adjMatrix, ROWS, COLS) => {
  // Rotate the maze grid
  let rotatedMaze = Array.from({ length: COLS }, () => Array(ROWS).fill(0));
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      rotatedMaze[col][ROWS - 1 - row] = maze[row][col];
    }
  }

  // Rotate the positions of the special nodes
  let rotatedSwapPositions = swapPositions.map(([row, col]) => [col, ROWS - 1 - row]);
  let rotatedRotatePositions = rotatePositions.map(([row, col]) => [col, ROWS - 1 - row]);

  // Rotate the adjacency matrix
  let rotatedAdjMatrix = Array.from({ length: ROWS * COLS }, () => Array(ROWS * COLS).fill(0));
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      let currentIndex = row * COLS + col;
      let rotatedRow = col;
      let rotatedCol = ROWS - 1 - row;
      let rotatedIndex = rotatedRow * COLS + rotatedCol;
      adjMatrix[currentIndex].forEach((isConnected, neighborIndex) => {
        if (isConnected) {
          let [neighborRow, neighborCol] = [Math.floor(neighborIndex / COLS), neighborIndex % COLS];
          let rotatedNeighborRow = neighborCol;
          let rotatedNeighborCol = ROWS - 1 - neighborRow;
          let rotatedNeighborIndex = rotatedNeighborRow * COLS + rotatedNeighborCol;
          rotatedAdjMatrix[rotatedIndex][rotatedNeighborIndex] = 1;
        }
      });
    }
  }

  return {
    rotatedMaze,
    rotatedSwapPositions,
    rotatedRotatePositions,
    rotatedAdjMatrix
  };
};

// Add an edge between two nodes in the adjacency matrix
const addEdge = (adjMatrix, nodes, ROWS=7, COLS=7) => {
  const [node1, node2] = nodes;
  const index1 = node1[0] * COLS + node1[1];
  const index2 = node2[0] * COLS + node2[1];
  const isNode1Valid = isValidMatrixIndex(node1, ROWS, COLS);
  const isNode2Valid = isValidMatrixIndex(node2, ROWS, COLS);
  if (isNode1Valid && isNode2Valid) {
    adjMatrix[index1][index2] = 1;
    adjMatrix[index2][index1] = 1;
  } else {
    throw new Error("One or both of the nodes are out of bounds");
  }
};

// Delete an edge between two nodes in the adjacency matrix
const delEdge = (adjMatrix, nodes, ROWS, COLS) => {
  const [node1, node2] = nodes;
  const index1 = node1[0] * COLS + node1[1];
  const index2 = node2[0] * COLS + node2[1];
  if (isValidMatrixIndex(node1, ROWS, COLS) && isValidMatrixIndex(node2, ROWS, COLS)) {
    adjMatrix[index1][index2] = 0;
    adjMatrix[index2][index1] = 0;
  } else {
    throw new Error("One or both of the nodes are out of bounds");
  }
};

const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

const getAvailableOperations = (nodeDetails) => {
  return Object.entries(nodeDetails.operation)
    .filter(([key, value]) => value.positions.length > 0)
    .map(([key, value]) => value.type);

};

const applyOperationsToPicture = (picture, operations) => {
  let newPicture = { ...picture, elements: picture.elements.map(element => ({ ...element })) };
  operations.forEach(({ action, elementIndex }) => {
    const element = newPicture.elements[elementIndex];
    if (element) {
      if (action === "addRotate45") {
        element.rotationAngle = (element.rotationAngle + 45) % 360;
      } else if (action === "rotate180") {
        element.rotationAngle = (element.rotationAngle + 180) % 360;
      }
    }
  });
  return newPicture;
};

const generateNodeDetails = () => {
  return {
    player: {
      type: 'player',
      color: 'blue',
      mazeName: 'player',

    },
    start: {
      positions:[[0, 0]],
      type: 'start_node',
      color: 'yellow',
      mazeName: 's',
    },
    goal: {
      positions: [[4, 4], [6, 6]],
      type: 'goal_node',
      color: ['green', '#90EE90'],
      mazeName: 'g',
      rewards: [25, 75] 
    },
    operation: {
      node1: {
        positions: [],
        color: 'red',
        quantity: 2,
        mazeName: 2,
        operations: [
/*           {
            type: 'rotate180',
            params: null,
            targetElementIndex: [1]
          }, */
          {
            type: 'addRotate45',
            params: null,
            targetElementIndex: [1]
          }
        ],
        predefinedPositions: null,
        randomPositions: true,
      },
      node2: {
        positions: [],
        color: 'purple',
        quantity: 1,
        mazeName: 3,
        operations: [
          {
            type: 'rotate180',
            params: null,
            targetElementIndex: [2]
          },
          {
            type: 'addEdge',
            params: ([[1,2], [1,4]]),
            targetElementIndex: [2]
          },
        ],
        predefinedPositions: null,
        randomPositions: true,
      }
    }
  };
};


const mapMazeNameToColor = (nodeDetails) => {
  const colorMap = {
    0: 'black',  // Map 0 to black
    1: 'white'   // Map 1 to white
  };

  // Helper function to handle node details
  const addToColorMap = (details, mazeName) => {
    if (!colorMap[mazeName]) {
      colorMap[mazeName] = [];
    }
    if (Array.isArray(details.color)) {
      details.positions.forEach((pos, index) => {
        colorMap[mazeName][index] = details.color[index % details.color.length]; // Use modulus to cycle through colors if fewer colors than positions
      });
    } else {
      details.positions.forEach(() => {
        colorMap[mazeName].push(details.color);
      });
    }
  };

  // Iterate over nodeDetails
  Object.entries(nodeDetails).forEach(([key, details]) => {
    if (key === 'operation') {
      Object.values(details).forEach(operationNode => {
        addToColorMap(operationNode, operationNode.mazeName);
      });
    } else {
      if (Array.isArray(details.positions)) {
        addToColorMap(details, details.mazeName);
      } else {
        colorMap[details.mazeName] = details.color;
      }
    }
  });

  return colorMap;
};


const ProgressBar = ({ progress}) => {
  const barStyle = {
    width: `${WIDTH}px`,
    backgroundColor: '#ddd',
  };

  const fillStyle = {
    width: `${Math.max(0, progress) * 100}%`, // Ensure progress is not negative for rendering
    height: '30px',
    backgroundColor: '#4caf50',
  };

  return (
    <div style={barStyle}>
      <div style={fillStyle}></div>
    </div>
  );
}; 


const RewardBar = ({ reward, mazeWidth, mazeHeight }) => {
  const containerStyle = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  };

  const barStyle = {
    width: '30px',
    height: `${mazeHeight}px`, // Adjust the height as needed
    backgroundColor: '#ddd',
    border: '1px solid #ccc',
    borderRadius: '5px',
    overflow: 'hidden',
    position: 'absolute',
    left: `${mazeWidth + 0}px`, // Distance from the right edge of the maze
    top: '50%', // Align to the top of the maze
    transform: 'translateY(-100%)', // Center vertically
  };

  const fillStyle = {
    height: `${Math.min(100, Math.max(0, reward))}%`, // Ensure progress is between 0 and 100
    width: '100%',
    backgroundColor: '#FFFF00',
    transition: 'height 0.3s ease-in-out', // Smooth transition for the fill
    position: 'absolute',
    bottom: '0', // Align to the bottom of the bar
  };

  return (
    <div style={containerStyle}>
      <div style={barStyle}>
        <div style={fillStyle}></div>
      </div>
    </div>
  );
}; 

const generateSubsets = (arr) => {
  const subsets = [];
  const len = arr.length;
  for (let i = 0; i < (1 << len); i++) {
    const subset = [];
    for (let j = 0; j < len; j++) {
      if (i & (1 << j)) {
        subset.push(arr[j]);
      }
    }
    subsets.push(subset);
  }
  return subsets;
};

const permute = (arr) => {
  if (arr.length <= 1) return [arr];
  const permutations = [];
  const smallerPermutations = permute(arr.slice(1));
  const firstElement = arr[0];
  for (let i = 0; i < smallerPermutations.length; i++) {
    const smallerPermutation = smallerPermutations[i];
    for (let j = 0; j <= smallerPermutation.length; j++) {
      const prefix = smallerPermutation.slice(0, j);
      const suffix = smallerPermutation.slice(j);
      permutations.push([...prefix, firstElement, ...suffix]);
    }
  }
  return permutations;
};

const arePicturesEqual = (picture1, picture2) => {
  if (picture1.elements.length !== picture2.elements.length) return false;
  
  return picture1.elements.every((element, index) => {
    const goalElement = picture2.elements[index];
    return element.shape === goalElement.shape &&
      element.width === goalElement.width &&
      element.height === goalElement.height &&
      element.radius === goalElement.radius &&
      element.color === goalElement.color &&
      element.offsetX === goalElement.offsetX &&
      element.offsetY === goalElement.offsetY &&
      element.rotationAngle === goalElement.rotationAngle &&
      element.x === goalElement.x &&
      element.y === goalElement.y;
  });
};

const findNextNodesToActivate = (mazeData, currentPicture, goalPicture, nodeDetails) => {
  const availableNodes = [];
  for (let row = 0; row < mazeData.maze.length; row++) {
    for (let col = 0; col < mazeData.maze[row].length; col++) {
      const value = mazeData.maze[row][col];
      for (const key in nodeDetails.operation) {
        if (nodeDetails.operation[key].mazeName === value) {
          availableNodes.push({
            node: key,
            operations: nodeDetails.operation[key].operations,
            position: [row, col]
          });
        }
      }
    }
  }

  const operationNodes = availableNodes.map(node => ({
    nodeKey: node.node,
    operations: node.operations.filter(op => op.type !== 'addEdge') // filter out 'addEdge' operations
  }));


  const allSubsets = generateSubsets(operationNodes);
  const allPossibleGoalOrders = allSubsets.flatMap(subset => permute(subset));

  const validGoalOrders = allPossibleGoalOrders.filter(order => {
    const operations = order.flatMap(opNode => opNode.operations.flatMap(op => 
      op.targetElementIndex.map(index => ({
        action: op.type,
        elementIndex: index
      }))
    ));
    const newGoalPicture = applyOperationsToPicture(currentPicture, operations);

    const isValid = arePicturesEqual(newGoalPicture, goalPicture);

    return isValid;
  });

  const nextNodes = [];
  validGoalOrders.forEach(order => {
    order.forEach(opNode => {
      availableNodes.forEach(node => {
        if (node.node === opNode.nodeKey) {
          nextNodes.push({
            node: opNode.nodeKey,
            position: node.position
          });
        }
      });
    });
  });

  return nextNodes.filter(node => node.position !== null);
};

const unpackNextNodes = (nextNodes, goalPositions) => {
  if (nextNodes.length === 0) {
    return goalPositions;
  }

  return nextNodes.map(node => node.position);
};

const getRewardFromPlayerPos = (playerPos, goal) => {
  const index = goal.positions.findIndex(pos => pos[0] === playerPos[0] && pos[1] === playerPos[1]);
  return index !== -1 ? goal.rewards[index] : null;
};


const ControlPanel = ({ settings, updateSettings, mazeData, handleUpdateMazeData, onManualChange, picture, updatePicture}) => {

  const handleUpdateMazeDataInternal = (updatedMazeData) => {
    handleUpdateMazeData(updatedMazeData);
    updateSettings((prev) => ({
      ...prev,
      mazeData: updatedMazeData,
    }));
  };

  const handleToggleChange = (key) => {
    updateSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handlePictureChange = (index, field, value) => {
    const updatedElements = picture.elements.map((element, i) => {
      if (i === index) {
        return { ...element, [field]: value };
      }
      return element;
    });
    updatePicture({ elements: updatedElements });
    updateSettings((prev) => ({
      ...prev,
      currentPicture: { elements: updatedElements }
    }));
   
  };

  const handleAddElement = () => {
    const newElement = {
      shape: 'circle',
      radius: 30,
      color: 'white',
      x: settings.WIDTH / 2 - 150,
      y: 50,
      offsetX: 0,
      offsetY: 0,
    };
    updatePicture({ elements: [...picture.elements, newElement] });
    updateSettings((prev) => ({
      ...prev,
      currentPicture: { elements: [...prev.currentPicture.elements, newElement] }
    }));
  };

  const handleDeleteElement = (index) => {
    const updatedElements = settings.currentPicture.elements.filter((_, i) => i !== index);
    updatePicture({ elements: updatedElements });
    updateSettings((prev) => ({
      ...prev,
      currentPicture: { elements: updatedElements }
    }));
  };

  const handleInputChange = (key, event) => {
    let value;
    if (event.target.type === 'number') {
      value = parseFloat(event.target.value);
    } else {
      value = event.target.value;
    }
    if (key === 'ROWS' || key === 'COLS') {
      value = Math.max(0, Math.min(7, value));
    }
    updateSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleWallColorChange = (index, event) => {
    const value = event.target.value;
    updateSettings((prev) => {
      const newWallColor = [...prev.wallColor];
      newWallColor[index] = value;
      return { ...prev, wallColor: newWallColor };
    });
  };

  const handleMazeCropChange = (index, event, ROWS = 7, COLS = 7) => {
    const maxValue = index % 2 === 0 ? settings.ROWS - 1 : settings.COLS - 1;
    const value = Math.max(0, Math.min(parseInt(event.target.value, 10), maxValue));
    updateSettings((prev) => {
      const newMazeCrop = [...prev.mazeCrop];
      newMazeCrop[index] = isNaN(value) ? 0 : value;
      return { ...prev, mazeCrop: newMazeCrop };
    });
  };

  const handleNodeDetailChange = (nodeType, field, value, index = null, nodeKey = null) => {
    updateSettings((prev) => {
      const updatedNodeDetails = { ...prev.nodeDetails };
  
      // Handle position changes specifically
      if (field === 'positions') {
        const oldPosition = updatedNodeDetails[nodeType].positions[index];
        if (nodeKey) {
          updatedNodeDetails[nodeType][nodeKey][field][index] = value;
        } else {
          updatedNodeDetails[nodeType][field][index] = value;
        }
  
        // Reset the old position color to gray (normal node color)
        const updatedMazeData = { ...prev.mazeData };
        if (oldPosition) {
          const [oldRow, oldCol] = oldPosition;
          updatedMazeData.maze[oldRow][oldCol] = 1; // Assuming 1 is the default value for normal nodes
        }
  
        return { ...prev, nodeDetails: updatedNodeDetails, mazeData: updatedMazeData };
      } else {
        if (nodeKey) {
          if (index !== null) {
            updatedNodeDetails[nodeType][nodeKey][field][index] = value;
          } else {
            updatedNodeDetails[nodeType][nodeKey][field] = value;
          }
        } else {
          if (index !== null) {
            updatedNodeDetails[nodeType][field][index] = value;
          } else {
            updatedNodeDetails[nodeType][field] = value;
          }
        }
        return { ...prev, nodeDetails: updatedNodeDetails };
      }
    });
  };

  const handleAddOperation = (nodeKey) => {
    updateSettings((prev) => {
      const updatedNodeDetails = { ...prev.nodeDetails };
      updatedNodeDetails.operation[nodeKey].operations.push({
        type: 'addRotate45',
        params: null,
        targetElementIndex: [],
      });
      return { ...prev, nodeDetails: updatedNodeDetails };
    });
  };

  const handleRemoveOperation = (nodeKey, index) => {
    updateSettings((prev) => {
      const updatedNodeDetails = { ...prev.nodeDetails };
      updatedNodeDetails.operation[nodeKey].operations.splice(index, 1);
      return { ...prev, nodeDetails: updatedNodeDetails };
    });
  };

  const handleAddGoalNode = () => {
    updateSettings((prev) => {
      const updatedNodeDetails = { ...prev.nodeDetails };
      updatedNodeDetails.goal.positions.push([0, 0]);
      updatedNodeDetails.goal.color.push('green');
      updatedNodeDetails.goal.rewards.push(0);
      return { ...prev, nodeDetails: updatedNodeDetails };
    });
  };

  const handleRemoveGoalNode = (index) => {
    updateSettings((prev) => {
      const updatedNodeDetails = { ...prev.nodeDetails };
      updatedNodeDetails.goal.positions.splice(index, 1);
      updatedNodeDetails.goal.color.splice(index, 1);
      updatedNodeDetails.goal.rewards.splice(index, 1);
      return { ...prev, nodeDetails: updatedNodeDetails };
    });
  };

  const handleAddOperationPosition = (nodeKey) => {
    updateSettings((prev) => {
      const updatedNodeDetails = { ...prev.nodeDetails };
      updatedNodeDetails.operation[nodeKey].positions.push([0, 0]);
      updatedNodeDetails.operation[nodeKey].quantity = updatedNodeDetails.operation[nodeKey].positions.length;
      return { ...prev, nodeDetails: updatedNodeDetails };
    });
  };

  const handleRemoveOperationPosition = (nodeKey, index) => {
    updateSettings((prev) => {
      const updatedNodeDetails = { ...prev.nodeDetails };
      updatedNodeDetails.operation[nodeKey].positions.splice(index, 1);
      updatedNodeDetails.operation[nodeKey].quantity = updatedNodeDetails.operation[nodeKey].positions.length;
      return { ...prev, nodeDetails: updatedNodeDetails };
    });
  };

  const handleQuantityChange = (nodeKey, value) => {
    updateSettings((prev) => {
      const updatedNodeDetails = { ...prev.nodeDetails };
      const newQuantity = parseInt(value, 10) || 0;
      updatedNodeDetails.operation[nodeKey].quantity = newQuantity;
      while (updatedNodeDetails.operation[nodeKey].positions.length < newQuantity) {
        updatedNodeDetails.operation[nodeKey].positions.push([0, 0]);
      }
      while (updatedNodeDetails.operation[nodeKey].positions.length > newQuantity) {
        updatedNodeDetails.operation[nodeKey].positions.pop();
      }
      return { ...prev, nodeDetails: updatedNodeDetails };
    });
  };

  const handleParamsChange = (nodeKey, index, paramIndex, event) => {
    const value = parseInt(event.target.value, 10);
    updateSettings((prev) => {
      const updatedNodeDetails = { ...prev.nodeDetails };
      if (!Array.isArray(updatedNodeDetails.operation[nodeKey].operations[index].params)) {
        updatedNodeDetails.operation[nodeKey].operations[index].params = [[0, 0], [0, 0]];
      }
      updatedNodeDetails.operation[nodeKey].operations[index].params[Math.floor(paramIndex / 2)][paramIndex % 2] = isNaN(value) ? 0 : value;
      return { ...prev, nodeDetails: updatedNodeDetails };
    });
  };

  const handleRandomPositionChange = (nodeKey) => {
    updateSettings((prev) => {
      const updatedNodeDetails = { ...prev.nodeDetails };
      updatedNodeDetails.operation[nodeKey].randomPositions = !updatedNodeDetails.operation[nodeKey].randomPositions;
      if (updatedNodeDetails.operation[nodeKey].randomPositions) {
        updatedNodeDetails.operation[nodeKey].predefinedPositions = null;
      } else {
        updatedNodeDetails.operation[nodeKey].predefinedPositions = updatedNodeDetails.operation[nodeKey].positions;
      }
      return { ...prev, nodeDetails: updatedNodeDetails };
    });
  };

  return (
    <div className="control-panel">
      <h3 className="control-panel-header">Control Panel</h3>

      <Section title="Maze">
        <InteractiveMaze mazeData={mazeData} 
                         onUpdateMazeData={handleUpdateMazeDataInternal} 
                         nodeDetails={settings.nodeDetails}
                         onManualChange={onManualChange} 
                         updateSettings={updateSettings}
                         settings={settings} // Pass settings as a prop
                         />
        <InputField
          label="Connectivity Sparsity"
          type="number"
          value={settings.connectivitySparsity}
          onChange={(e) => handleInputChange('connectivitySparsity', e)}
        />
        <InputField
          label="Maze Seed"
          type="text"
          value={settings.mazeSeed}
          onChange={(e) => handleInputChange('mazeSeed', e)}
        />
        <InputField
          label="Operation Node Seed"
          type="text"
          value={settings.operationNodeSeed}
          onChange={(e) => handleInputChange('operationNodeSeed', e)}
        />
        <div className="input-group">
          <label className="label">Crop Maze:</label>
          {[0, 1, 2, 3].map((index) => (
            <input
              key={index}
              type="number"
              value={settings.mazeCrop[index]}
              onChange={(e) => handleMazeCropChange(index, e)}
              className="small-input"
            />
          ))}
        </div>
        <Checkbox
          label="fullyConnected"
          checked={settings.fullyConnected}
          onChange={() => handleToggleChange('fullyConnected')}
          key="fullyConnected"
        />
      </Section>

      <Section title="Maze Visuals">
        <Checkbox
          label="Hide Edges"
          checked={settings.hideEdges}
          onChange={() => handleToggleChange('hideEdges')}
          key="hideEdges"
        />
        <Checkbox
          label="Edges on Top of Nodes"
          checked={settings.edgesOnTopOfNodes}
          onChange={() => handleToggleChange('edgesOnTopOfNodes')}
          key="edgesOnTopOfNodes"
        />
        <Checkbox
          label="Node and Edges"
          checked={settings.nodeAndEdges}
          onChange={() => handleToggleChange('nodeAndEdges')}
          key="nodeAndEdges"
        />
        <InputField
          label="Node Size"
          type="number"
          value={settings.nodeSize}
          onChange={(e) => handleInputChange('nodeSize', e)}
        />
        <InputField
          label="Edge Width"
          type="number"
          value={settings.edgeWidth}
          onChange={(e) => handleInputChange('edgeWidth', e)}
        />
        <InputField
          label="Wall Width"
          type="number"
          value={settings.borderWidth}
          onChange={(e) => handleInputChange('borderWidth', e)}
        />
        <div className="input-group">
          <label className="label">Wall Colors:</label>
          {settings.wallColor.map((color, index) => (
            <input
              key={`wall-color-${index}`}
              type="text"
              value={color}
              onChange={(e) => handleWallColorChange(index, e)}
              className="small-input"
            />
          ))}
        </div>
      </Section>

      <Section title="Fog">
        <Checkbox
          label="Show All Nodes"
          checked={settings.showAllNodes}
          onChange={() => handleToggleChange('showAllNodes')}
          key="showAllNodes"
        />
        <Checkbox
          label="Show Goal"
          checked={settings.showGoal}
          onChange={() => handleToggleChange('showGoal')}
          key="showGoal"
        />
        <Checkbox
          label="Show Operations"
          checked={settings.showOperations}
          onChange={() => handleToggleChange('showOperations')}
          key="showOperations"
        />
        <Checkbox
          label="Show Start"
          checked={settings.showStart}
          onChange={() => handleToggleChange('showStart')}
          key="showStart"
        />
        <Checkbox
          label="Show Current Picture"
          checked={settings.showCurrentPicture}
          onChange={() => handleToggleChange('showCurrentPicture')}
          key="showCurrentPicture"
        />
        <Checkbox
          label="Show Goal Picture"
          checked={settings.showGoalPicture}
          onChange={() => handleToggleChange('showGoalPicture')}
          key="showGoalPicture"
        />
        <InputField
          label="Visibility Radius"
          type="number"
          value={settings.visibilityRadius}
          onChange={(e) => handleInputChange('visibilityRadius', e)}
        />
      </Section>

      <Section title="Reinforcers">
        <Checkbox
          label="Progress Bar"
          checked={settings.progressBar}
          onChange={() => handleToggleChange('progressBar')}
          key="progressBar"
        />
        <Checkbox
          label="Reward Bar"
          checked={settings.rewardBar}
          onChange={() => handleToggleChange('rewardBar')}
          key="rewardBar"
        />
      </Section>

      <Section title="Start Node">
        <div className="input-group">
          <label className="label">Row:</label>
          <input
            type="number"
            value={settings.nodeDetails.start.positions[0][0]}
            onChange={(e) =>
              handleNodeDetailChange(
                'start',
                'positions',
                [parseInt(e.target.value, 10), settings.nodeDetails.start.positions[0][1]],
                0
              )
            }
            className="small-input"
          />
          <label className="label">Column:</label>
          <input
            type="number"
            value={settings.nodeDetails.start.positions[0][1]}
            onChange={(e) =>
              handleNodeDetailChange(
                'start',
                'positions',
                [settings.nodeDetails.start.positions[0][0], parseInt(e.target.value, 10)],
                0
              )
            }
            className="small-input"
          />
        </div>
        <InputField
          label="Color"
          type="text"
          value={settings.nodeDetails.start.color}
          onChange={(e) => handleNodeDetailChange('start', 'color', e.target.value)}
        />
      </Section>

      <Section title="Goal Nodes">
        {settings.nodeDetails.goal.positions.map((pos, index) => (
          <Section key={`goal-node-${index}`} title={`Goal Node ${index + 1}`}>
            <div className="input-group">
              <label className="label">Row:</label>
              <input
                type="number"
                value={pos[0]}
                onChange={(e) =>
                  handleNodeDetailChange(
                    'goal',
                    'positions',
                    [parseInt(e.target.value, 10), pos[1]],
                    index
                  )
                }
                className="small-input"
              />
              <label className="label">Column:</label>
              <input
                type="number"
                value={pos[1]}
                onChange={(e) =>
                  handleNodeDetailChange(
                    'goal',
                    'positions',
                    [pos[0], parseInt(e.target.value, 10)],
                    index
                  )
                }
                className="small-input"
              />
            </div>
            <InputField
              label="Color"
              type="text"
              value={settings.nodeDetails.goal.color[index]}
              onChange={(e) =>
                handleNodeDetailChange('goal', 'color', e.target.value, index)
              }
            />
            <InputField
              label={`Reward`}
              type="number"
              value={settings.nodeDetails.goal.rewards[index]}
              onChange={(e) =>
                handleNodeDetailChange('goal', 'rewards', parseFloat(e.target.value), index)
              }
            />
            <button onClick={() => handleRemoveGoalNode(index)} className="remove-button">Remove Goal Node</button>
          </Section>
        ))}
        <button onClick={handleAddGoalNode} className="add-button">Add Goal Node</button>
      </Section>

      <Section title="Operation Nodes">
        <Checkbox
          label="Consumable"
          checked={settings.consumable}
          onChange={() => handleToggleChange('consumable')}
          key="consumable"
        />
        {Object.keys(settings.nodeDetails.operation).map((nodeKey) => (
          <Section key={`operation-node-${nodeKey}`} title={`${nodeKey}`}>
            <InputField
              label="Color"
              type="text"
              value={settings.nodeDetails.operation[nodeKey].color}
              onChange={(e) =>
                handleNodeDetailChange('operation', 'color', e.target.value, null, nodeKey)
              }
            />
            <Checkbox
              label="Random Positions"
              checked={settings.nodeDetails.operation[nodeKey].randomPositions || false}
              onChange={() => handleRandomPositionChange(nodeKey)}
              key={`random-positions-${nodeKey}`}
            />
            <InputField
              label="Quantity"
              type="number"
              value={settings.nodeDetails.operation[nodeKey].quantity}
              onChange={(e) => handleQuantityChange(nodeKey, e.target.value)}
            />
            {!settings.nodeDetails.operation[nodeKey].randomPositions &&
              settings.nodeDetails.operation[nodeKey].positions.map((pos, index) => (
                <div key={`operation-position-${nodeKey}-${index}`} className="input-group">
                  <label className="label">Row:</label>
                  <input
                    type="number"
                    value={pos[0]}
                    onChange={(e) =>
                      handleNodeDetailChange(
                        'operation',
                        'positions',
                        [parseInt(e.target.value, 10), pos[1]],
                        index,
                        nodeKey
                      )
                    }
                    className="small-input"
                  />
                  <label className="label">Column:</label>
                  <input
                    type="number"
                    value={pos[1]}
                    onChange={(e) =>
                      handleNodeDetailChange(
                        'operation',
                        'positions',
                        [pos[0], parseInt(e.target.value, 10)],
                        index,
                        nodeKey
                      )
                    }
                    className="small-input"
                  />
                  <button onClick={() => handleRemoveOperationPosition(nodeKey, index)} className="remove-button">Remove Position</button>
                </div>
              ))}
            <button onClick={() => handleAddOperationPosition(nodeKey)} className="add-button" style={{ marginBottom: '10px' }}>
              Add Position
            </button>

            {settings.nodeDetails.operation[nodeKey].operations.map((operation, index) => (
              <div key={`operation-${nodeKey}-${index}`} className="operation-section">
                <Section key={`operation-${index}`} title={`Operation ${index + 1}`}>
                  <label>Type</label>
                  <select
                    value={operation.type}
                    onChange={(e) =>
                      handleNodeDetailChange(
                        'operation',
                        'operations',
                        { ...operation, type: e.target.value },
                        index,
                        nodeKey
                      )
                    }
                    className="operation-select"
                  >
                    <option value="addRotate45">addRotate45</option>
                    <option value="rotate180">rotate180</option>
                    <option value="addEdge">addEdge</option>
                  </select>
                  {operation.type === 'addEdge' ? (
                    <div className="params-group">
                      <div>
                        <span>From node: </span>
                        {[0, 1].map((paramIndex) => (
                          <input
                            key={`param-from-${paramIndex}`}
                            type="number"
                            value={
                              Array.isArray(operation.params)
                                ? operation.params[Math.floor(paramIndex / 2)][paramIndex % 2]
                                : 0
                            }
                            onChange={(e) =>
                              handleParamsChange(nodeKey, index, paramIndex, e)
                            }
                            className="small-input"
                          />
                        ))}
                      </div>
                      <div>
                        <span>To node: </span>
                        {[2, 3].map((paramIndex) => (
                          <input
                            key={`param-to-${paramIndex}`}
                            type="number"
                            value={
                              Array.isArray(operation.params)
                                ? operation.params[Math.floor(paramIndex / 2)][paramIndex % 2]
                                : 0
                            }
                            onChange={(e) =>
                              handleParamsChange(nodeKey, index, paramIndex, e)
                            }
                            className="small-input"
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <InputField
                        label="Params"
                        type="text"
                        value={JSON.stringify(operation.params)}
                        onChange={(e) =>
                          handleNodeDetailChange(
                            'operation',
                            'operations',
                            { ...operation, params: JSON.parse(e.target.value) },
                            index,
                            nodeKey
                          )
                        }
                      />
                      <InputField
                        label="Target Element Index"
                        type="text"
                        value={operation.targetElementIndex.join(',')}
                        onChange={(e) =>
                          handleNodeDetailChange(
                            'operation',
                            'operations',
                            {
                              ...operation,
                              targetElementIndex: e.target.value.split(',').map(Number),
                            },
                            index,
                            nodeKey
                          )
                        }
                      />
                    </div>
                  )}
                  <button onClick={() => handleRemoveOperation(nodeKey, index)} className="remove-button">Remove Operation</button>
                </Section>
              </div>
            ))}
            <button onClick={() => handleAddOperation(nodeKey)} className="add-button">
              Add Operation
            </button>
          </Section>
        ))}
      </Section>
      <Section title="Picture Visibility">
        <div className="input-group">
          <label className="label">Picture Start Time:</label>
          <div style={{margin:'5px'}}> 
            <input
              type="number"
              value={settings.pictureVisibility[0]}
              onChange={(e) =>
                updateSettings((prev) => ({
                  ...prev,
                  pictureVisibility: [parseInt(e.target.value, 10), settings.pictureVisibility[1]],
                }))
              }
              className="small-input"
              
            />
            <label className="label" style={{marginLeft:'5px'}}>Seconds</label>
          </div>
          <label style={{marginTop:'5px'}} className="label">Picture End Time:</label>
          <div style={{margin:'5px'}}> 
            <input
              type="number"
              value={settings.pictureVisibility[1]}
              onChange={(e) =>
                updateSettings((prev) => ({
                  ...prev,
                  pictureVisibility: [settings.pictureVisibility[0], parseInt(e.target.value, 10)],
                }))
              }
              className="small-input"
              
            />
            <label className="label" style={{marginLeft:'5px'}}>Seconds</label>
          </div>
        </div>
      </Section>
      <Section title="Goal Picture Visibility">
        <div className="input-group">
          <label style={{marginTop:'5px'}} className="label">Goal Picture Start Time:</label>
          <div style={{margin:'5px'}}>
            <input
            type="number"
            value={settings.goalPictureVisibility[0]}
            onChange={(e) =>
              updateSettings((prev) => ({
                ...prev,
                goalPictureVisibility: [parseInt(e.target.value, 10), settings.goalPictureVisibility[1]],
              }))
            }
            className="small-input"
            />
            <label className="label" style={{marginLeft:'5px'}}>Seconds</label>
          </div>
          <label style={{marginTop:'5px'}} className="label">Goal Picture End Time (s):</label>
          <div style={{margin:'5px'}}>
            <input
              type="number"
              value={settings.goalPictureVisibility[1]}
              onChange={(e) =>
                updateSettings((prev) => ({
                  ...prev,
                  goalPictureVisibility: [settings.goalPictureVisibility[0], parseInt(e.target.value, 10)],
                }))
              }
              className="small-input"
            />
            <label className="label" style={{marginLeft:'5px'}}>Seconds</label>
          </div>
        </div>
      </Section>
      <Section title="Picture">
        {picture.elements.map((element, index) => (
          <Section key={`element-${index}`} title={`Element ${index + 1}`}>
            <select
              value={element.shape}
              onChange={(e) => handlePictureChange(index, 'shape', e.target.value)}
              className="operation-select"
            >
              <option value="circle">Circle</option>
              <option value="rect">Rectangle</option>
            </select>
            {element.shape === 'circle' && (
              <InputField
                label="Radius"
                type="number"
                value={element.radius}
                onChange={(e) => handlePictureChange(index, 'radius', parseFloat(e.target.value))}
              />
            )}
            {element.shape === 'rect' && (
              <>
                <InputField
                  label="Width"
                  type="number"
                  value={element.width}
                  onChange={(e) => handlePictureChange(index, 'width', parseFloat(e.target.value))}
                />
                <InputField
                  label="Height"
                  type="number"
                  value={element.height}
                  onChange={(e) => handlePictureChange(index, 'height', parseFloat(e.target.value))}
                />
              </>
            )}
            <InputField
              label="Color"
              type="text"
              value={element.color}
              onChange={(e) => handlePictureChange(index, 'color', e.target.value)}
            />
            <InputField
              label="X Position"
              type="number"
              value={element.x}
              onChange={(e) => handlePictureChange(index, 'x', parseFloat(e.target.value))}
            />
            <InputField
              label="Y Position"
              type="number"
              value={element.y}
              onChange={(e) => handlePictureChange(index, 'y', parseFloat(e.target.value))}
            />
            <InputField
              label="Offset X"
              type="number"
              value={element.offsetX}
              onChange={(e) => handlePictureChange(index, 'offsetX', parseFloat(e.target.value))}
            />
            <InputField
              label="Offset Y"
              type="number"
              value={element.offsetY}
              onChange={(e) => handlePictureChange(index, 'offsetY', parseFloat(e.target.value))}
            />
            {element.shape === 'rect' && (
              <InputField
                label="Rotation Angle"
                type="number"
                value={element.rotationAngle}
                onChange={(e) => handlePictureChange(index, 'rotationAngle', parseFloat(e.target.value))}
              />
            )}
            <button className="remove-button" onClick={() => handleDeleteElement(index)}>Delete Element</button>
          </Section>
        ))}
        <button className="add-button" onClick={handleAddElement}>Add Element</button>
      </Section>
    </div>
  );
};

const Section = ({ title, children }) => (
  <div className="section">
    <div className="section-title">{title}</div>
    {children}
  </div>
);

const InputField = ({ label, type, value, onChange }) => (
  <div className="input-group">
    <label className="label">{label}:</label>
    <input
      type={type}
      value={value}
      onChange={onChange}
      className="input"
    />
  </div>
);

const Checkbox = ({ label, checked, onChange }) => (
  <div className="input-group">
    <label className="label">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="checkbox"
      />
      {label}
    </label>
  </div>
);

const updateMazeDataFromNodeDetails = (mazeData, nodeDetails, ROWS, COLS) => {
  if (!mazeData || !mazeData.maze || !mazeData.adjMatrix) {
    console.error("Invalid mazeData provided:", mazeData);
    return mazeData;
  }

  if (!nodeDetails || typeof nodeDetails !== 'object') {
    console.error("Invalid nodeDetails provided:", nodeDetails);
    return mazeData;
  }

  // Create new maze and adjMatrix with updated dimensions
  const newMaze = Array.from({ length: ROWS }, () => Array(COLS).fill(1));
  const newAdjMatrix = Array.from({ length: ROWS * COLS }, () => Array(ROWS * COLS).fill(0));

  // Copy existing maze data into new maze, ensuring we do not go out of bounds
  for (let row = 0; row < Math.min(mazeData.maze.length, ROWS); row++) {
    for (let col = 0; col < Math.min(mazeData.maze[0].length, COLS); col++) {
      newMaze[row][col] = mazeData.maze[row][col];
    }
  }

  // Copy existing adjMatrix data into new adjMatrix, ensuring we do not go out of bounds
  for (let row = 0; row < Math.min(mazeData.adjMatrix.length, ROWS * COLS); row++) {
    for (let col = 0; col < Math.min(mazeData.adjMatrix[0].length, ROWS * COLS); col++) {
      newAdjMatrix[row][col] = mazeData.adjMatrix[row][col];
    }
  }

  // Update maze with names from nodeDetails
  const newMazeWithNodes = updateMazeWithNodeNames(newMaze, nodeDetails, true);

  // Return updated mazeData
  return { maze: newMazeWithNodes, adjMatrix: newAdjMatrix, nodeDetails };
};



const SettingsManager = ({ settings, updateSettings, setTrialSettings, trial }) => {
  const [trialRange, setTrialRange] = useState([1, 2]);
  const [configurations, setConfigurations] = useState([]);
  const [configName, setConfigName] = useState('');

  const saveConfiguration = () => {
    const newConfig = {
      name: configName || `Config ${configurations.length + 1}`,
      settings: JSON.parse(JSON.stringify(settings)), // Deep copy settings
      trialRange: [...trialRange],
      nodeDetails: JSON.parse(JSON.stringify(settings.nodeDetails)), // Deep copy nodeDetails
    };
    setConfigurations((prevConfigs) => [...prevConfigs, newConfig]);
    setConfigName('');
  };
  
  const applyConfiguration = (config) => {
    const newSettings = {
      ...config.settings,
      nodeDetails: JSON.parse(JSON.stringify(config.nodeDetails)), // Deep copy nodeDetails
      manual_changes: JSON.parse(JSON.stringify(config.settings.manual_changes || [])) // Ensure deep copy of manual changes
    };
    updateSettings(newSettings);
    setTrialSettings(config.trialRange);
    console.log('apply config pressed', newSettings);
  };

  const deleteConfiguration = (index) => {
    setConfigurations((prevConfigs) => prevConfigs.filter((_, i) => i !== index));
  };
  
  useEffect(() => {
    const currentConfig = configurations.find(
      (config) => trial >= config.trialRange[0] && trial <= config.trialRange[1]
    );
    if (currentConfig) {
      applyConfiguration(currentConfig);
    } else if (configurations.length > 0) {
      alert('No more configurations. Session finished.');
    }
  }, [trial, configurations]);
  
  return (
    <div style={settingsManagerStyles.container}>
      <h3 style={settingsManagerStyles.header}>Trial Manager</h3>
      <div style={settingsManagerStyles.formGroup}>
        <label style={settingsManagerStyles.label}>Settings Configuration Name:</label>
        <input
          type="text"
          value={configName}
          onChange={(e) => setConfigName(e.target.value)}
          style={settingsManagerStyles.input}
        />
      </div>
      <div style={settingsManagerStyles.formGroup}>
        <label style={settingsManagerStyles.label}>Start Trial:</label>
        <input
          type="number"
          value={trialRange[0]}
          onChange={(e) => setTrialRange([parseInt(e.target.value, 10), trialRange[1]])}
          style={settingsManagerStyles.input}
        />
      </div>
      <div style={settingsManagerStyles.formGroup}>
        <label style={settingsManagerStyles.label}>End Trial:</label>
        <input
          type="number"
          value={trialRange[1]}
          onChange={(e) => setTrialRange([trialRange[0], parseInt(e.target.value, 10)])}
          style={settingsManagerStyles.input}
        />
      </div>
      <button onClick={saveConfiguration} style={settingsManagerStyles.saveButton}>Save Configuration</button>
      <div style={settingsManagerStyles.configList}>
        <h4 style={settingsManagerStyles.configHeader}>Saved Configurations</h4>
        {configurations.map((config, index) => (
          <div key={index} style={settingsManagerStyles.configItem}>
            <span>
              {config.name} - Trials {config.trialRange[0]} to {config.trialRange[1]}
            </span>
            <button onClick={() => applyConfiguration(config)} style={settingsManagerStyles.applyButton}>
              Apply Configuration
            </button>
            <button onClick={() => deleteConfiguration(index)} style={settingsManagerStyles.deleteButton}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

const settingsManagerStyles = {
  container: {
    paddingRight: '20px',
    paddingLeft: '20px',
    paddingTop: '10px',
    border: '1px solid #ccc',
    borderRadius: '5px',
    backgroundColor: '#f9f9f9',
    maxWidth: '400px',
    margin: 'auto',
  },
  header: {
    //textAlign: 'center',
    //marginBottom: '20px',
    marginbBottom:'20px',
    textAlign: 'center',
    fontSize: '1.5em',
    fontWeight: 'bold',
    color: '#333',
  },
  formGroup: {
    marginBottom: '10px',
  },
  label: {
    display: 'block',
    marginBottom: '5px',
  },
  input: {
    width: '100%',
    padding: '8px',
    boxSizing: 'border-box',
    borderRadius: '4px',
    border: '1px solid #ccc',
  },
  saveButton: {
    display: 'block',
    width: '100%',
    padding: '10px',
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  saveButtonHover: {
    backgroundColor: '#45a049',
  },
  configList: {
    marginTop: '20px',
  },
  configHeader: {
    textAlign: 'center',
    marginBottom: '10px',
  },
  configItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px',
    borderBottom: '1px solid #ccc',
  },
  applyButton: {
    padding: '5px 10px',
    backgroundColor: '#008CBA',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: 13,
    marginLeft: '10px'
  
  },
  deleteButton: {
    backgroundColor: '#d9534f',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    padding: '5px 10px',
    cursor: 'pointer',
    marginLeft: '10px',
  },
};




const InteractiveMaze = ({ mazeData, onUpdateMazeData, nodeDetails, onManualChange, updateSettings, settings }) => {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [nodeSelection, setNodeSelection] = useState([]);
  const [isAddEdgeMode, setIsAddEdgeMode] = useState(false);
  const [isDeleteEdgeMode, setIsDeleteEdgeMode] = useState(false);
  const [history, setHistory] = useState([]); // History stack for undo functionality
  const [manualChanges, setManualChanges] = useState([]); // Manual changes state

  useEffect(() => {
    if (mazeData && mazeData.maze && mazeData.adjMatrix) {
      const newNodes = [];
      const newEdges = [];

      mazeData.maze.forEach((row, rowIndex) => {
        row.forEach((cell, colIndex) => {
          newNodes.push({ row: rowIndex, col: colIndex, type: cell });
        });
      });

      mazeData.adjMatrix.forEach((row, rowIndex) => {
        row.forEach((cell, colIndex) => {
          if (cell === 1) {
            newEdges.push({ from: rowIndex, to: colIndex });
          }
        });
      });

      setNodes(newNodes);
      setEdges(newEdges);
    }
  }, [mazeData]);

  const saveToHistory = (data) => {
    setHistory((prevHistory) => [...prevHistory, JSON.stringify(data)]);
  };

  // Ensure each state before a change is registered in history
  useEffect(() => {
    saveToHistory({ ...mazeData }); // Save current state before change
  }, [mazeData]);

  const handleUndo = () => {
    if (history.length > 0) {
      const lastState = JSON.parse(history[history.length - 1]);
      onUpdateMazeData(lastState);
      setHistory((prevHistory) => prevHistory.slice(0, -1));
      setNodes(lastState.maze.flatMap((row, rowIndex) =>
        row.map((cell, colIndex) => ({ row: rowIndex, col: colIndex, type: cell }))
      )); // Restore nodes state

      // Remove the last change from manual_changes
      updateSettings((prevSettings) => {
        const updatedManualChanges = prevSettings.manual_changes.slice(0, -1);
        return { ...prevSettings, manual_changes: updatedManualChanges };
      });
    }
  };

  const handleNodeClick = (node) => {
    if (isAddEdgeMode) {
      setNodeSelection((prev) => {
        const newSelection = [...prev, node];
        if (newSelection.length === 2) {
          handleAddEdge(newSelection[0], newSelection[1]);
          return [];
        }
        return newSelection;
      });
    } else {
      saveToHistory({ ...mazeData }); // Save current state before change
      const newMaze = mazeData.maze.map((row, rowIndex) =>
        row.map((cell, colIndex) =>
          rowIndex === node.row && colIndex === node.col ? (cell === 1 ? 0 : 1) : cell
        )
      );
      onUpdateMazeData({ ...mazeData, maze: newMaze });
      const change = { type: 'node', action: 'toggle', position: [node.row, node.col] };
      onManualChange(change); // Track the change
      setManualChanges((prev) => [...prev, change]); // Save manual change
      setNodes((prevNodes) =>
        prevNodes.map((n) =>
          n.row === node.row && n.col === node.col
            ? { ...n, type: node.type === 1 ? 0 : 1 }
            : n
        )
      );
    }
    setSelectedNode(node);
  };

  const handleDeactivateAll = () => {
    saveToHistory({ ...mazeData }); // Save current state before change

    // Create new maze with all nodes deactivated except for start and goal nodes
    const newMaze = mazeData.maze.map((row, rowIndex) =>
      row.map((cell, colIndex) => {
        // Check if the current position is a start node
        if (nodeDetails.start.positions.some(pos => pos[0] === rowIndex && pos[1] === colIndex)) {
          return nodeDetails.start.mazeName; // Preserve the start node
        }
        // Check if the current position is a goal node
        if (nodeDetails.goal.positions.some(pos => pos[0] === rowIndex && pos[1] === colIndex)) {
          return nodeDetails.goal.mazeName; // Preserve the goal node
        }
        return 0; // Deactivate other nodes
      })
    );

    // Create new adjacency matrix with all edges deactivated
    const newAdjMatrix = mazeData.adjMatrix.map((row) => row.map(() => 0));

    // Update the maze data
    onUpdateMazeData({ ...mazeData, maze: newMaze, adjMatrix: newAdjMatrix });

    const changes = [
      { type: 'node', action: 'deactivate_all' },
      { type: 'deactivate_all_edges' },
    ];

    onManualChange(changes[0]); // Track the node change
    onManualChange(changes[1]); // Track the edge change
    setManualChanges((prev) => [...prev, ...changes]); // Save manual changes
    setNodes((prevNodes) =>
      prevNodes.map((node) => {
        // Check if the current node is a start or goal node and preserve its type
        if (nodeDetails.start.positions.some(pos => pos[0] === node.row && pos[1] === node.col)) {
          return { ...node, type: nodeDetails.start.mazeName };
        }
        if (nodeDetails.goal.positions.some(pos => pos[0] === node.row && pos[1] === node.col)) {
          return { ...node, type: nodeDetails.goal.mazeName };
        }
        return { ...node, type: 0 }; // Deactivate other nodes
      })
    );
    setEdges([]);
  };

  const handleAddEdge = (fromNode, toNode) => {
    saveToHistory({ ...mazeData }); // Save current state before change
    const fromIndex = fromNode.row * mazeData.maze[0].length + fromNode.col;
    const toIndex = toNode.row * mazeData.maze[0].length + toNode.col;
    const newAdjMatrix = mazeData.adjMatrix.map((row, rowIndex) =>
      row.map((cell, colIndex) =>
        (rowIndex === fromIndex && colIndex === toIndex) ||
        (rowIndex === toIndex && colIndex === fromIndex)
          ? 1
          : cell
      )
    );
    onUpdateMazeData({ ...mazeData, adjMatrix: newAdjMatrix });
    const change = { type: 'edge', action: 'add', from: [fromNode.row, fromNode.col], to: [toNode.row, toNode.col] };
    onManualChange(change); // Track the change
    setManualChanges((prev) => [...prev, change]); // Save manual change
    setEdges((prevEdges) => [
      ...prevEdges,
      { from: fromIndex, to: toIndex },
      { from: toIndex, to: fromIndex },
    ]);
  };

  const deepCopy = (obj) => {
    return JSON.parse(JSON.stringify(obj));
  };

  const handleDeleteEdge = (edgeToDelete) => {
    saveToHistory(deepCopy(mazeData)); // Save current state before change
    const newAdjMatrix = mazeData.adjMatrix.map((row, rowIndex) =>
      row.map((cell, colIndex) =>
        (rowIndex === edgeToDelete.from && colIndex === edgeToDelete.to) ||
        (rowIndex === edgeToDelete.to && colIndex === edgeToDelete.from)
          ? 0
          : cell
      )
    );
    onUpdateMazeData({ ...mazeData, adjMatrix: newAdjMatrix });
  
    const change = { type: 'edge', action: 'delete', from: [Math.floor(edgeToDelete.from / mazeData.maze[0].length), edgeToDelete.from % mazeData.maze[0].length], to: [Math.floor(edgeToDelete.to / mazeData.maze[0].length), edgeToDelete.to % mazeData.maze[0].length] };
    onManualChange(change); // Track the change
    setManualChanges((prev) => [...prev, change]); // Save manual change
  
    setEdges((prevEdges) =>
      prevEdges.filter(
        (edge) =>
          !(
            (edge.from === edgeToDelete.from && edge.to === edgeToDelete.to) ||
            (edge.from === edgeToDelete.to && edge.to === edgeToDelete.from)
          )
      )
    );
  };

  const getColorForNode = (node) => {
    if (node.type === 's') {
      return nodeDetails.start.color;
    } else if (node.type === 'g') {
      const goalIndex = nodeDetails.goal.positions.findIndex(
        ([row, col]) => row === node.row && col === node.col
      );
      return nodeDetails.goal.color[goalIndex] || 'black';
    } else if (node.type === 2) {
      const OpNode1Index = nodeDetails.operation.node1.positions.findIndex(
        ([row, col]) => row === node.row && col === node.col
      );
      return OpNode1Index !== -1 ? nodeDetails.operation.node1.color : 'black';
    } else if (node.type === 3) {
      const OpNode2Index = nodeDetails.operation.node2.positions.findIndex(
        ([row, col]) => row === node.row && col === node.col
      );
      return OpNode2Index !== -1 ? nodeDetails.operation.node2.color : 'black';
    } else {
      return nodeDetails[node.type]?.color || 'darkblue';
    }
  };

  const GRID_SIZE = Math.min(WIDTH, HEIGHT - 100) / 12; // Adjust as needed
  const CIRCLE_RADIUS = 20; // Adjust as needed

  return (
    <div>
      <button onClick={() => setIsAddEdgeMode((prev) => !prev)} className="maze-button">
        {isAddEdgeMode ? 'Disable Add Edge' : 'Enable Add Edge'}
      </button>
      <button onClick={() => setIsDeleteEdgeMode((prev) => !prev)} className="maze-button">
        {isDeleteEdgeMode ? 'Disable Delete Edge' : 'Enable Delete Edge'}
      </button>
      <button onClick={handleDeactivateAll} className="maze-button">Deactivate All</button>
      <button onClick={handleUndo} disabled={history.length === 0} className="maze-button">
        Undo
      </button>
      <Stage width={300} height={300}>
        <Layer>
          {edges.map((edge, index) => {
            const fromNode = nodes.find(
              (node) =>
                node.row * mazeData.maze[0].length + node.col === edge.from
            );
            const toNode = nodes.find(
              (node) =>
                node.row * mazeData.maze[0].length + node.col === edge.to
            );
            if (fromNode && toNode) {
              return (
                <Line
                  key={index}
                  points={[
                    fromNode.col * GRID_SIZE + GRID_SIZE / 2,
                    fromNode.row * GRID_SIZE + GRID_SIZE / 2,
                    toNode.col * GRID_SIZE + GRID_SIZE / 2,
                    toNode.row * GRID_SIZE + GRID_SIZE / 2,
                  ]}
                  stroke="black"
                  opacity={1} // Ensure active edges are fully visible
                  onClick={() => isDeleteEdgeMode && handleDeleteEdge(edge)}
                  strokeWidth={5}
                />
              );
            }
            return null;
          })}
          {nodes.map((node, index) => (
            <React.Fragment key={index}>
              <Circle
                x={node.col * GRID_SIZE + GRID_SIZE / 2}
                y={node.row * GRID_SIZE + GRID_SIZE / 2}
                radius={CIRCLE_RADIUS / 2}
                fill={getColorForNode(node)}
                opacity={node.type === 0 || node.type === null ? 0.1 : 1} // Faint for inactive nodes
                onClick={() => handleNodeClick(node)}
                draggable={false} // Ensure nodes cannot be dragged
              />
              {nodeSelection.some((n) => n.row === node.row && n.col === node.col) && (
                <Circle
                  x={node.col * GRID_SIZE + GRID_SIZE / 2}
                  y={node.row * GRID_SIZE + GRID_SIZE / 2}
                  radius={CIRCLE_RADIUS}
                  stroke="red"
                  strokeWidth={2}
                />
              )}
            </React.Fragment>
          ))}
        </Layer>
      </Stage>
    </div>
  );
};



const defaultMaze = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1]
];

const defaultNodeDetails = generateNodeDetails()

const createUnconnectedAdjMatrix = () => {
  const matrixSize = 7 * 7;
  return Array.from({ length: matrixSize }, () => Array(matrixSize).fill(0));
};

const defaultAdjMatrix = createUnconnectedAdjMatrix();

const initializeMazeData = () => {
  const maze = defaultMaze;
  const nodeDetails = defaultNodeDetails;
  const adjMatrix = defaultAdjMatrix;
  return { maze, nodeDetails, adjMatrix };
};



const MazeGame = () => {
  const [trial, setTrial] = useState(1);
  const [trialSettings, setTrialSettings] = useState([]);
  const [nodeDetails, setNodeDetails] = useState(generateNodeDetails());
  const [mazeData, setMazeData] = useState(initializeMazeData);
  const [goalRotationAngle, setGoalRotationAngle] = useState(0);
  const [currentPicture, setCurrentPicture] = useState(picture);
  const [goalPicture, setGoalPicture] = useState(picture);
  const [showTrialScreen, setShowTrialScreen] = useState(false);
  const [allowHoldKeyDown, setAllowHoldKeyDown] = useState(false);
  const keyDownRef = useRef(false); // Use ref for synchronous state tracking
  const [goalPicturePosition, setGoalPicturePosition] = useState([
    WIDTH / 2 + 150, 50,
  ]); // Example position
  const [currentPicturePosition, setCurrentPicturePosition] = useState([
    WIDTH / 2 - 150, 50,
  ]); // Example position
  
  const [progress, setProgress] = useState(0); // Add state for progress
  const [initialDistance, setInitialDistance] = useState(0); // Add state for initial distance
  const [normDist, setNormDist] = useState(true); // Add state for initial distance
  const [reward, setReward] = useState(0); // Add state for initial distance
  const [logs, setLogs] = useState([]); // State for data logs
  const [pid, setPid] = useState('0'); // State for data logs
  const [movingAllowed, setMovingAllowed] = useState(true);
  const [isHover, setIsHover] = useState(false);
   // Add state to track the current time
  const [currentTime, setCurrentTime] = useState(0);
  const [settings, setSettings] = useState({
    visibilityRadius: 1263,
    WIDTH: 500,
    HEIGHT: 700,
    GRID_SIZE: Math.min(WIDTH, HEIGHT - 100) / 7, // 7
    ROWS: 7,
    COLS: 7,
    CIRCLE_RADIUS: GRID_SIZE / 4,
    TOTAL_TRIALS: 10,
    hideEdges: false,
    showAllNodes: false,
    edgesOnTopOfNodes: false,
    edgeWidth: 20,
    nodeAndEdges: true,
    wallColor: ['black', 'black', 'black', 'black'], // Default wall colors ['grey', 'grey', 'grey', 'grey']
    borderWidth: 5,
    nodeSize: CIRCLE_RADIUS,
    showGoal: true,
    showOperations: true,
    showStart: true,
    showCurrentPicture: true,
    showGoalPicture: true,
    visibilityRadiusNode: 0.25,
    visibilityRadiusPicture: 0.5,
    connectivitySparsity: 0.2,
    mazeSeed: null,
    operationNodeSeed: null,
    mazeStructure: null,
    fullyConnected: true,
    mazeCrop: [0, 0, 6, 6],
    progressBar: true,
    rewardBar: true,
    nodeDetails: nodeDetails,
    consumable: true,
    mazeData: mazeData,
    manual_changes: [], // Initialize manual_changes as an empty array
    pictureVisibility: [0, 2000], // Default visibility time range for picture
    goalPictureVisibility: [0, 3000], // Default visibility time range for goalPicture
    currentPicture: currentPicture, 
    goalPicture: goalPicture,
  });
  
  // Update the current time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(prevTime => prevTime + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Reset current time every new trial
  useEffect(() => {
    setCurrentTime(0);
  }, [trial]);

  // Use effect to update picture and goalPicture visibility based on time range
  useEffect(() => {
    const [pictureStart, pictureEnd] = settings.pictureVisibility;
    const [goalPictureStart, goalPictureEnd] = settings.goalPictureVisibility;

    setSettings(prevSettings => ({
      ...prevSettings,
      showCurrentPicture: currentTime >= pictureStart && currentTime <= pictureEnd,
      showGoalPicture: currentTime >= goalPictureStart && currentTime <= goalPictureEnd
    }));
  }, [currentTime, settings.pictureVisibility, settings.goalPictureVisibility]);


  const handleManualChange = (change) => {
    setSettings((prevSettings) => {
      const updatedManualChanges = [...(prevSettings.manual_changes || []), change];
      return { ...prevSettings, manual_changes: updatedManualChanges };
    });
  };

  // Use effect to update settings.mazeData when mazeData changes
  useEffect(() => {
      setSettings((prevSettings) => ({
        ...prevSettings,
        mazeData: mazeData,
      }));
  }, [mazeData]);

// Ensure settings.goalPicture is updated when goalPicture state is updated
  useEffect(() => {
    setSettings((prevSettings) => ({
      ...prevSettings,
      goalPicture: goalPicture,
    }));
}, [goalPicture, currentPicture]);

  const [playerPos, setPlayerPos] = useState(
    settings.nodeDetails.start.positions[0]
  );
  const [colorMap, setColorMap] = useState(
    mapMazeNameToColor(settings.nodeDetails)
  ); // State for colorMap

  // Update node details and mazeData based on settings.nodeDetails
  useEffect(() => {
    if (mazeData && settings.nodeDetails && settings) {
      const updatedMazeData = updateMazeDataFromNodeDetails(
        mazeData,
        settings.nodeDetails,
        settings.ROWS,
        settings.COLS
        
      );
      setMazeData(updatedMazeData);
      setNodeDetails(settings.nodeDetails);
    }
  
  }, [settings.nodeDetails, settings.ROWS, settings.COLS]);
  

  // Ensure movement is allowed at start of trial
  useEffect(() => {
    setMovingAllowed(true);
  }, [trial]);

  
  const updateSettings = (newSettings) => {
    setSettings((prevSettings) => {
      const updatedSettings = { ...prevSettings, ...newSettings };
      updatedSettings.GRID_SIZE = Math.min(settings.WIDTH, settings.HEIGHT - 100) / 7;
      updatedSettings.CIRCLE_RADIUS = settings.GRID_SIZE / 4;
      updatedSettings.nodeSize = settings.nodeSize;
  
      // Update maze data if nodeDetails are changed
      const flag = true;
      if (flag) {
        setNodeDetails(newSettings.nodeDetails);
  
        const updatedMazeData = updateMazeDataFromNodeDetails(
          mazeData,
          newSettings.nodeDetails,
          settings.ROWS,
          settings.COLS
        );
        setMazeData(updatedMazeData);
        setNodeDetails(newSettings.nodeDetails);
        console.log('newSettings.nodeDetails post update', newSettings.nodeDetails);
      }
  
      // Ensure manual changes are applied
      if (newSettings.manual_changes) {
        const finalUpdatedMazeData = applyManualChanges({ ...mazeData }, newSettings.manual_changes);
        setMazeData(finalUpdatedMazeData);
        updatedSettings.mazeData = finalUpdatedMazeData;
      } else {
        updatedSettings.mazeData = mazeData;
      }
  
      return updatedSettings;
    });
  };
  
  // Function to log data
  const dataLog = (action, nextNodeToActivate = null, randomOperationNodes = null) => {
    const newLog = {
      time: new Date().toISOString(),
      action: action,
      currentPicture: JSON.stringify(currentPicture),
      goalPicture: JSON.stringify(goalPicture),
      nextNodeToActivate: nextNodeToActivate,
      playerAction: action,
      playerPos: JSON.stringify(playerPos),
      startNode: JSON.stringify(settings.nodeDetails.start.positions),
      goalNodes: JSON.stringify(settings.nodeDetails.goal.positions),
      operationNodes: JSON.stringify(settings.nodeDetails.operation),
      randomOperationNodes: randomOperationNodes,
      reward: reward,
      trialTime: trial, // Placeholder for actual trial time tracking
      mazeData: mazeData ? JSON.stringify(mazeData.maze) : null, // Log the current state of mazeData.maze if available
    };
    setLogs((prevLogs) => [...prevLogs, newLog]);
  };

  // Function to save logs to a file
  const saveLogsToFile = () => {
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `data_${date}_${pid}.json`;
    const fileToSave = new Blob([JSON.stringify(logs, null, 2)], {
      type: 'application/json',
    });
    saveAs(fileToSave, fileName);
  };

  // Save logs when the component is unmounted or the window is closed
  useEffect(() => {
    const handleBeforeUnload = (event) => {
      saveLogsToFile();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [logs]);

  // Function to get reward from player position
  const getRewardFromPlayerPos = (playerPos, goal) => {
    const index = goal.positions.findIndex(
      (pos) => pos[0] === playerPos[0] && pos[1] === playerPos[1]
    );
    return index !== -1 ? goal.rewards[index] : null;
  };

  // Calculate progress towards the closest goal
  const calculateProgress = (playerPos, goalPositions, normDist, initialDist = 0, ROWS = settings.ROWS, COLS = settings.COLS) => {
    // Calculate the distance to the closest goal
    const distances = goalPositions.map(
      (goal) => Math.abs(playerPos[0] - goal[0]) + Math.abs(playerPos[1] - goal[1])
    );
    const closestDistance = Math.min(...distances);

    if (normDist && initialDist !== undefined) {
      // Normalize progress: 0 at start, 1 at goal, negative if moving away
      return (initialDist - closestDistance) / initialDist;
    }

    const maxDistance = ROWS + COLS; // Maximum possible distance in the maze
    return 1 - closestDistance / maxDistance;
  };

  // Initialize progress based on the closest goal position
  const initializeProgress = (startPos, goalPositions, normDist) => {
    const distances = goalPositions.map(
      (goal) => Math.abs(startPos[0] - goal[0]) + Math.abs(startPos[1] - goal[1])
    );
    const initialDist = Math.min(...distances);
    setInitialDistance(initialDist);

    const initialProgress = calculateProgress(startPos, goalPositions, normDist, initialDist);
    setProgress(initialProgress);
  };

  const generateMaze2 = (nodeDetails, connectivitySparsity, mazeSeed, operationNodeSeed, mazeStructure, fullyConnected, manualChanges = []) => {
    let mazeData = generateMaze(nodeDetails, connectivitySparsity, mazeSeed, operationNodeSeed, mazeStructure, fullyConnected);
  
    manualChanges.forEach((change) => {
      if (change.type === 'node') {
        const [row, col] = change.position;
        if (change.action === 'toggle') {
          mazeData.maze[row][col] = mazeData.maze[row][col] === 1 ? 0 : 1;
        } else if (change.action === 'deactivate_all') {
          mazeData.maze = mazeData.maze.map((row) => row.map(() => 0));
        }
      } else if (change.type === 'edge') {
        const fromIndex = change.from[0] * mazeData.maze[0].length + change.from[1];
        const toIndex = change.to[0] * mazeData.maze[0].length + change.to[1];
        if (change.action === 'add') {
          mazeData.adjMatrix[fromIndex][toIndex] = 1;
          mazeData.adjMatrix[toIndex][fromIndex] = 1;
        } else if (change.action === 'delete') {
          mazeData.adjMatrix[fromIndex][toIndex] = 0;
          mazeData.adjMatrix[toIndex][fromIndex] = 0;
        }
      }
    });
  
    return mazeData;
  };
  
  
  const applyManualChanges = (mazeData, manualChanges = [], settings) => {
    const { maze, adjMatrix } = mazeData;
  
    manualChanges.forEach((change) => {
      console.log('Processing change:', change);
  
      if (change.type === 'node') {
        if (change.position) {
          const [row, col] = change.position;
          if (row >= 0 && row < maze.length && col >= 0 && col < maze[0].length) {
            if (change.action === 'toggle') {
              maze[row][col] = maze[row][col] === 1 ? 0 : 1;
            }
          } else {
            console.error(`Invalid node position: [${row}, ${col}]`);
          }
        } else if (change.action === 'deactivate_all') {
          maze.forEach((row, rowIndex) => {
            row.forEach((cell, colIndex) => {
              // Preserve start nodes
              if (settings.nodeDetails.start.positions.some(pos => pos[0] === rowIndex && pos[1] === colIndex)) {
                maze[rowIndex][colIndex] = settings.nodeDetails.start.mazeName;
              }
              // Preserve goal nodes
              else if (settings.nodeDetails.goal.positions.some(pos => pos[0] === rowIndex && pos[1] === colIndex)) {
                maze[rowIndex][colIndex] = settings.nodeDetails.goal.mazeName;
              }
              // Deactivate other nodes
              else {
                maze[rowIndex][colIndex] = 0;
              }
            });
          });
        }
      } else if (change.type === 'edge') {
        if (Array.isArray(change.from) && Array.isArray(change.to)) {
          const [fromRow, fromCol] = change.from;
          const [toRow, toCol] = change.to;
          const fromIndex = fromRow * maze[0].length + fromCol;
          const toIndex = toRow * maze[0].length + toCol;
  
          console.log('fromIndex:', fromIndex, 'toIndex:', toIndex);
  
          if (
            fromIndex >= 0 && fromIndex < adjMatrix.length &&
            toIndex >= 0 && toIndex < adjMatrix.length
          ) {
            if (change.action === 'add') {
              adjMatrix[fromIndex][toIndex] = 1;
              adjMatrix[toIndex][fromIndex] = 1;
            } else if (change.action === 'delete') {
              adjMatrix[fromIndex][toIndex] = 0;
              adjMatrix[toIndex][fromIndex] = 0;
            }
          } else {
            console.error(`Invalid edge indices: fromIndex = ${fromIndex}, toIndex = ${toIndex}`);
          }
        } else {
          console.error(`Invalid edge change: from or to position is not an array`);
        }
      } else if (change.type === 'deactivate_all_edges') {
        adjMatrix.forEach(row => row.fill(0));
      }
    });
  
    return { maze, adjMatrix };
  };
  

  
  useEffect(() => {
    const generateAndSetMaze = (details) => {
      let initialMazeData = generateMaze(
        details,
        settings.connectivitySparsity,
        settings.mazeSeed,
        settings.operationNodeSeed,
        settings.mazeStructure,
        settings.fullyConnected
      );
  
      if (settings.mazeCrop) {
        const { croppedMaze, croppedAdjMatrix, nodeDetails: adjNodeDetails } =
          cropAndAdjustMaze(
            initialMazeData.maze,
            initialMazeData.adjMatrix,
            details,
            settings.mazeCrop,
            settings.ROWS, 
            settings.COLS,
            settings.mazeSeed,
          );
  
        // Apply manual changes to the updated maze
        const finalMazeData = applyManualChanges({ maze: croppedMaze, adjMatrix: croppedAdjMatrix }, settings.manual_changes, settings);
  
        // Update maze with names from nodeDetails
        updateMazeWithNodeNames(finalMazeData.maze, settings.nodeDetails, true);
  
        // Ensure operation nodes are placed after manual changes 
        Object.keys(settings.nodeDetails.operation).forEach((key) => {
          const operation = settings.nodeDetails.operation[key];
          operation.positions = placeOperationNodes(
            finalMazeData.maze,
            operation.quantity,
            operation.mazeName,
            operation.predefinedPositions,
            null
          );
        });
  
        setMazeData(finalMazeData);
        setNodeDetails(settings.nodeDetails); // Set the updated node details
  
        setPlayerPos(settings.nodeDetails.start.positions[0]);
        initializeProgress(settings.nodeDetails.start.positions[0], settings.nodeDetails.goal.positions, normDist); // Initialize progress
      } else {
        // Apply manual changes to the initial maze data
        const finalMazeData = applyManualChanges(initialMazeData, settings.manual_changes, settings);
  
        setMazeData(finalMazeData);
        setPlayerPos(details.start.positions[0]);
        initializeProgress(details.start.positions[0], details.goal.positions, normDist); // Initialize progress
      }
  
      // Log data for maze generation
      dataLog('mazeGenerated');
    };
  
    generateAndSetMaze(settings.nodeDetails);
    setReward(0);
    setColorMap(mapMazeNameToColor(settings.nodeDetails)); // State for colorMap
  }, [
    settings.mazeCrop,
    trial,
    settings.connectivitySparsity,
    settings.ROWS,
    settings.COLS,
    settings.fullyConnected,
    settings.manual_changes // Add this dependency
  ]);
  
  

  // Helper function for shuffling array
  const shuffleArray = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  };

  // Set colormap
  useEffect(() => {
    const generatedColorMap = mapMazeNameToColor(settings.nodeDetails);
    setColorMap(generatedColorMap); // Ensure colorMap is set correctly
  }, [nodeDetails]);

  // Modify the goal picture through a random sequence of available operation nodes.
  useEffect(() => {
    const availableOperations = Object.keys(settings.nodeDetails.operation);
    if (availableOperations.length === 0) {
      setGoalRotationAngle(0);
      return;
    }

    // Generate an array of all operation nodes based on their quantity
    const operationNodes = availableOperations.flatMap((nodeKey) => {
      const node = nodeDetails.operation[nodeKey];
      return Array(node.quantity)
        .fill()
        .map(() => ({
          nodeKey,
          operations: node.operations,
        }));
    });

    // Shuffle the array and select a random subset
    const shuffledOperationNodes = shuffleArray(operationNodes);
    const randomOperationNodes = shuffledOperationNodes.slice(
      0,
      Math.floor(Math.random() * shuffledOperationNodes.length) + 1
    );

    // Generate goalOrder reflecting the order of activated operation nodes
    const goalOrder = randomOperationNodes.flatMap((opNode) => {
      const operations = opNode.operations;
      return operations.flatMap(({ type, targetElementIndex }) =>
        targetElementIndex.map((elementIndex) => ({ action: type, elementIndex }))
      );
    });

    const newGoalPicture = applyOperationsToPicture(settings.currentPicture, goalOrder);
    setGoalPicture(newGoalPicture);

    setGoalRotationAngle(
      goalOrder.reduce((angle, { action }) => {
        if (action === 'addRotate45') {
          return (angle + 45) % 360;
        } else if (action === 'rotate180') {
          return (angle + 180) % 360;
        }
        return angle;
      }, 0)
    );

    // Log data for goal picture generation
    dataLog('goalPictureGenerated', null, randomOperationNodes);
  }, [trial, settings.nodeDetails, settings.currentPicture]);

  // Handle the movement based on arrow keys
  const handleKeyDown = useCallback(
    (event) => {
      if (!allowHoldKeyDown && keyDownRef.current) return; // Prevent continuous movement if allowHoldKeyDown is false and a key is held down
      if (!movingAllowed) return;
      keyDownRef.current = true; // Set keyDown to true when a key is pressed

      let newPlayerPos = [...playerPos];
      let moved = false;
      let action = '';

      const currentIdx = playerPos[0] * settings.COLS + playerPos[1];

      const movePlayerToNode = (targetNode) => {
        if (isValid(mazeData.maze, targetNode, settings.ROWS, settings.COLS)) {
          newPlayerPos = targetNode;
          moved = true;
        }
      };

      if (event.key === 'ArrowLeft') {
        action = 'left';
        for (let col = 0; col < playerPos[1]; col++) {
          const targetIdx = playerPos[0] * settings.COLS + col;
          if (mazeData.adjMatrix[currentIdx][targetIdx] === 1) {
            movePlayerToNode([playerPos[0], col]);
            break;
          }
        }
      } else if (event.key === 'ArrowRight') {
        action = 'right';
        for (let col = playerPos[1] + 1; col < settings.COLS; col++) {
          const targetIdx = playerPos[0] * settings.COLS + col;
          if (mazeData.adjMatrix[currentIdx][targetIdx] === 1) {
            movePlayerToNode([playerPos[0], col]);
            break;
          }
        }
      } else if (event.key === 'ArrowUp') {
        action = 'up';
        for (let row = 0; row < playerPos[0]; row++) {
          const targetIdx = row * settings.COLS + playerPos[1];
          if (mazeData.adjMatrix[currentIdx][targetIdx] === 1) {
            movePlayerToNode([row, playerPos[1]]);
            break;
          }
        }
      } else if (event.key === 'ArrowDown') {
        action = 'down';
        for (let row = playerPos[0] + 1; row < settings.ROWS; row++) {
          const targetIdx = row * settings.COLS + playerPos[1];
          if (mazeData.adjMatrix[currentIdx][targetIdx] === 1) {
            movePlayerToNode([row, playerPos[1]]);
            break;
          }
        }
      }

      // Specify effect of stepping on operation nodes
      if (moved) {
        // set current player position
        setPlayerPos(newPlayerPos);

        // Find next nodes that needs to be activated
        var nextNodes = findNextNodesToActivate(
          mazeData,
          currentPicture,
          goalPicture,
          nodeDetails
        );
        var nextNodeToActivate = unpackNextNodes(
          nextNodes,
          nodeDetails.goal.positions
        );

        // Set progress towards goal nodes (operations or goals)
        setProgress(
          calculateProgress(newPlayerPos, nextNodeToActivate, normDist, initialDistance)
        ); // Update progress

        // Log data for player movement
        dataLog(action, nextNodeToActivate);

        // Node value at the player position
        const currentMazeValue = mazeData.maze[newPlayerPos[0]][newPlayerPos[1]];

        Object.values(nodeDetails.operation).forEach((node) => {
          if (currentMazeValue === node.mazeName) {
            node.operations.forEach((operation) => {
              console.log('Performing operation:', operation.type, 'with params:', operation.params);
              if (operation.type === 'addEdge') {
                addEdge(mazeData.adjMatrix, operation.params, settings.ROWS, settings.COLS);
              } else {
                operation.targetElementIndex.forEach((elementIndex) => {
                  const element = currentPicture.elements[elementIndex];

                  if (element) {
                    if (operation.type === 'rotate180') {
                      rotateRect180(currentPicture, elementIndex);
                    } else if (operation.type === 'addRotate45') {
                      rotateRect45(currentPicture, elementIndex);
                    }
                  }
                });
              }
            });

            setCurrentPicture({ ...currentPicture });
            if (settings.consumable) {
              mazeData.maze[newPlayerPos[0]][newPlayerPos[1]] = 1; // Reset node value to 1 (neutral path)
            }
            setMazeData({ ...mazeData });
          }
        });

        // Check if current picture matches goal picture
        const isMatch = currentPicture.elements.every((element, index) => {
          const goalElement = goalPicture.elements[index];
          const match =
            element.shape === goalElement.shape &&
            element.width === goalElement.width &&
            element.height === goalElement.height &&
            element.radius === goalElement.radius &&
            element.color === goalElement.color &&
            element.offsetX === goalElement.offsetX &&
            element.offsetY === goalElement.offsetY &&
            element.rotationAngle === goalElement.rotationAngle &&
            element.x === goalElement.x &&
            element.y === goalElement.y;

          return match;
        });

        // If player in goal and picture is matching, end trial and start next trial.
        const isAtGoalPosition = nodeDetails.goal.positions.some(
          (pos) => pos[0] === newPlayerPos[0] && pos[1] === newPlayerPos[1]
        );

        if (isAtGoalPosition) {
          if (isMatch) {
            setMovingAllowed(false);
            if (trial < TOTAL_TRIALS) {
              var goalReward = getRewardFromPlayerPos(newPlayerPos, nodeDetails.goal);
              setReward(goalReward);
              console.log('Reward update at trial', reward);
              setTimeout(() => {
                setShowTrialScreen(true);
                setTimeout(() => {
                  setTrial(trial + 1);
                  setPlayerPos(settings.nodeDetails.start.positions[0]);
                  console.log('player pos', nodeDetails.start.positions[0]);
                  setCurrentPicture(picture);
                  setShowTrialScreen(false);

                  // Log data for reward and trial end
                  dataLog('reward', null, null);
                  dataLog('trialEnd', null, null);
                }, 2000); // 2000 milliseconds delay
              }, 1000); // 1000 milliseconds delay
            } else {
              setShowTrialScreen(true);
              setTimeout(() => {
                alert('You completed all trials! Congratulations!');
                dataLog('allTrialsComplete', null, null); // Log completion of all trials
              }, 2000);
            }
          }
        }
      }
    },
    [playerPos, mazeData, currentPicture, goalPicture, goalRotationAngle, trial, nodeDetails]
  );

  // Handle the release of a pressed/held key
  const handleKeyUp = useCallback(() => {
    keyDownRef.current = false; // Reset keyDown when a key is released
  }, []);

  // Apply the keyUp and keyDown effect at the event
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  // Draw goal nodes
  const drawGoalPositions = (goalPositions, colors) => {
    return goalPositions.map((pos, index) => {
      return (
        <Circle
          key={`goal-${index}`}
          x={pos[1] * GRID_SIZE + GRID_SIZE / 2}
          y={pos[0] * GRID_SIZE + GRID_SIZE / 2 + 100}
          radius={CIRCLE_RADIUS + 2}
          fill={colors[index]} // Use the corresponding color from the colors array
        />
      );
    });
  };

  // Show loading screen when generating maze
  if (!mazeData) {
    return <div>Loading...</div>;
  }

  // Function to skip the current trial
  const handleSkipTrial = () => {
    if (trial < settings.TOTAL_TRIALS) {
      dataLog('trialSkipped'); // Log trial skip
      
      setShowTrialScreen(true);
      setTimeout(() => {
        setTrial(trial + 1);
        setPlayerPos(settings.nodeDetails.start.positions[0]);
        setCurrentPicture(picture);
        setShowTrialScreen(false);

        // Log data for reward and trial end
        dataLog('reward', null, null);
        dataLog('trialEnd', null, null);
      }, 2000); // 2000 milliseconds delay
      
    } else {
      alert('You have completed all trials!');
    }
  };

 

  const handleMouseEnter = () => {
    setIsHover(true);
  };

  const handleMouseLeave = () => {
    setIsHover(false);
  };

  const skipTrialButtonStyle = {
    Button: {
      display: 'block',
      width: '20%',
      padding: '10px',
      backgroundColor: '#cccccc',
      color: 'black',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      position: 'absolute', 
      top: -60, 
      right: 200 
    },

    ButtonHover: {
      backgroundColor: 'white', // Hover color
    },
   
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'row' }}>
      <div style={{ position: 'relative' }}>
        <Stage width={settings.WIDTH} height={settings.HEIGHT}>
          <Layer>
            <Rect x={0} y={0} width={settings.WIDTH} height={settings.HEIGHT} fill="black" />
            {showTrialScreen ? (
              <Text
                text={`Trial ${trial}`}
                fontSize={40}
                fill="white"
                x={settings.WIDTH / 2}
                y={settings.HEIGHT / 2}
                offsetX={20}
                offsetY={20}
              />
            ) : (
              <>
                {drawMaze(
                  settings.mazeData.maze,
                  settings.mazeData.adjMatrix,
                  settings.currentPicture,
                  settings.goalPicture,
                  settings.nodeDetails,
                  colorMap,
                  settings.hideEdges,
                  settings.showAllNodes,
                  settings.edgesOnTopOfNodes,
                  settings.edgeWidth,
                  settings.nodeAndEdges,
                  settings.wallColor, // Default wall colors
                  settings.borderWidth,
                  settings.nodeSize,
                  settings.GRID_SIZE,
                  settings.ROWS,
                  settings.COLS,
                  settings.showCurrentPicture,
                  settings.showGoalPicture,
                )}
                <Circle
                  x={nodeDetails.start.positions[0][1] * settings.GRID_SIZE + settings.GRID_SIZE / 2}
                  y={nodeDetails.start.positions[0][0] * settings.GRID_SIZE + settings.GRID_SIZE / 2 + 100}
                  radius={settings.CIRCLE_RADIUS + 2}
                  fill={nodeDetails.start.color}
                />
                {drawGoalPositions(settings.nodeDetails.goal.positions, settings.nodeDetails.goal.color)}
                <Circle
                  x={playerPos[1] * settings.GRID_SIZE + settings.GRID_SIZE / 2}
                  y={playerPos[0] * settings.GRID_SIZE + settings.GRID_SIZE / 2 + 100}
                  radius={settings.CIRCLE_RADIUS}
                  fill={nodeDetails.player.color}
                />
              </>
            )}
          </Layer>
          <Layer>
            {showTrialScreen ? (
              <></>
            ) : (
              <>
                {drawFog(
                  playerPos,
                  nodeDetails,
                  goalPicturePosition,
                  currentPicturePosition,
                  settings.showAllNodes,
                  settings.showGoal,
                  settings.showOperations,
                  settings.showStart,
                  settings.showCurrentPicture,
                  settings.showGoalPicture,
                  settings.nodeAndEdges,
                  settings.visibilityRadius,
                  settings.visibilityRadiusNode,
                  settings.visibilityRadiusPicture,
                  settings.nodeSize,
                  settings.ROWS,
                  settings.COLS
                )}
              </>
            )}
          </Layer>
        </Stage>
        <div style={{ position: 'absolute', bottom: 0, width: '100%' }}>
          <div style={{position: 'relative', marginBottom: '30px',}}>
            <button onClick={handleSkipTrial} 
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                        style={isHover ? { ...skipTrialButtonStyle.Button, ...skipTrialButtonStyle.ButtonHover } : skipTrialButtonStyle.Button}>
                  Skip Trial
            </button>
          </div>
          {settings.progressBar && (
            
            <div style={{ position: 'absolute', bottom: 0, width: `${settings.WIDTH}px` }}>
              
              <ProgressBar progress={progress} />
            </div>
          )}
        </div>
        <div style={{ position: 'absolute', bottom: 0, width: '100%' }}>
          {settings.rewardBar && (
            <div style={{ position: 'absolute', bottom: 0, width: `${settings.WIDTH}px` }}>
              <RewardBar reward={reward} mazeWidth={settings.WIDTH} mazeHeight={settings.HEIGHT+18} />
            </div>
          )}
        </div>
      </div>
      <div style={{ marginLeft: '40px' }}> {/* Add margin to the right */}
        <ControlPanel settings={settings} 
                      updateSettings={setSettings} 
                      mazeData={mazeData} 
                      handleUpdateMazeData={setMazeData} 
                      onManualChange={handleManualChange} // Pass the manual change handler
                      picture = {currentPicture} 
                      updatePicture  = {setCurrentPicture} 
                      />
      </div>
      <div style={{marginLeft:'10px'}}>
        <SettingsManager
          settings={settings}
          updateSettings={updateSettings}
          setTrialSettings={setTrialSettings}
          trial={trial}
      />
      </div>
    </div>
  );
};

export default MazeGame;

