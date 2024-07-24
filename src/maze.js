// maze.js

import Random from './random';

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
    FOG: 'rgba(0, 0, 0, 0.9)'
};
const visibility_radius = GRID_SIZE * 10;

let maze, adj_matrix, player_pos, goal_pos, rect_left, rotation_angle, goal_rect_left, goal_rotation_angle, swap_positions, rotate_positions;
let log_data = [];
let goal_picture_position = [0, 0];  // Dummy initialization
let current_picture_position = [0, 0];  // Dummy initialization

function generate_maze() {
    const maze_seed = 22;
    const op_place_seed = 21;
    const removal_prob = 0.3;

    while (true) {
        maze = Array.from({ length: ROWS }, () => Array(COLS).fill(1));
        adj_matrix = Array.from({ length: ROWS * COLS }, () => Array(ROWS * COLS).fill(0));

        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                get_neighbors([row, col]).forEach(neighbor => {
                    if (is_valid_matrix_index(neighbor)) {
                        adj_matrix[row * COLS + col][neighbor[0] * COLS + neighbor[1]] = 1;
                    }
                });
            }
        }

        const start = [0, 0];
        const goal = [ROWS - 1, COLS - 1];
        player_pos = start;
        goal_pos = goal;

        remove_edges_or_nodes(start, goal, removal_prob, maze_seed);
        remove_isolated_nodes();
        swap_positions = place_operation_nodes(2, 2, op_place_seed);
        rotate_positions = place_operation_nodes(2, 3, op_place_seed);
        remove_invalid_edges();
        remove_unreachable_nodes(start);
        ensure_connectivity([start, goal, ...swap_positions, ...rotate_positions]);

        if (bfs(start, goal)) break;
    }
}

function get_neighbors(pos) {
    return [
        [pos[0] - 1, pos[1]],
        [pos[0] + 1, pos[1]],
        [pos[0], pos[1] - 1],
        [pos[0], pos[1] + 1]
    ];
}

function is_valid_matrix_index(pos) {
    return 0 <= pos[0] && pos[0] < ROWS && 0 <= pos[1] && pos[1] < COLS;
}

function remove_edges_or_nodes(start, goal, removal_prob, seed) {
    const local_random = new Random(seed);
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            if (local_random.random() < removal_prob) {
                const current_index = row * COLS + col;
                get_neighbors([row, col]).forEach(neighbor => {
                    if (is_valid_matrix_index(neighbor)) {
                        const neighbor_index = neighbor[0] * COLS + neighbor[1];
                        if (adj_matrix[current_index][neighbor_index] === 1) {
                            adj_matrix[current_index][neighbor_index] = 0;
                            adj_matrix[neighbor_index][current_index] = 0;
                            if (!bfs(start, goal)) {
                                adj_matrix[current_index][neighbor_index] = 1;
                                adj_matrix[neighbor_index][current_index] = 1;
                            }
                        }
                    }
                });
            }
        }
    }
}

function remove_isolated_nodes() {
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const current_index = row * COLS + col;
            if (adj_matrix[current_index].reduce((a, b) => a + b, 0) === 0) {
                maze[row][col] = 0;
            }
        }
    }
}

function place_operation_nodes(num_nodes, node_type, seed) {
    const local_random = new Random(seed);
    const positions = [];
    while (positions.length < num_nodes) {
        const x = local_random.choice([...Array(ROWS - 2).keys()]) + 1;
        const y = local_random.choice([...Array(COLS - 2).keys()]) + 1;
        if (maze[x][y] === 1) {
            maze[x][y] = node_type;
            positions.push([x, y]);
        }
    }
    return positions;
}

function ensure_connectivity(critical_nodes) {
    for (let i = 0; i < critical_nodes.length - 1; i++) {
        for (let j = i + 1; j < critical_nodes.length; j++) {
            ensure_path(critical_nodes[i], critical_nodes[j]);
        }
    }
}

function ensure_path(start, goal) {
    if (!bfs(start, goal)) {
        const path = generate_path(start, goal);
        path.forEach(pos => {
            maze[pos[0]][pos[1]] = 1;
        });
        update_adjacency_matrix(start);
        update_adjacency_matrix(goal);
    }
}

function generate_path(start, goal) {
    const q = [];
    q.push([start, [start]]);
    const visited = new Set();
    visited.add(start.toString());

    while (q.length > 0) {
        const [current, path] = q.shift();
        if (current[0] === goal[0] && current[1] === goal[1]) return path;

        get_neighbors(current).forEach(neighbor => {
            if (is_valid(maze, neighbor) && !visited.has(neighbor.toString())) {
                visited.add(neighbor.toString());
                q.push([neighbor, [...path, neighbor]]);
            }
        });
    }
    return [];
}

function update_adjacency_matrix(pos, remove = false) {
    const index = pos[0] * COLS + pos[1];
    get_neighbors(pos).forEach(neighbor => {
        const neighbor_index = neighbor[0] * COLS + neighbor[1];
        if (is_valid_matrix_index(neighbor)) {
            adj_matrix[index][neighbor_index] = remove ? 0 : 1;
            adj_matrix[neighbor_index][index] = remove ? 0 : 1;
        }
    });
}

function remove_invalid_edges() {
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const current_index = row * COLS + col;
            get_neighbors([row, col]).forEach(neighbor => {
                if (!is_valid(maze, neighbor)) {
                    const neighbor_index = neighbor[0] * COLS + neighbor[1];
                    if (is_valid_matrix_index([row, col]) && is_valid_matrix_index(neighbor)) {
                        adj_matrix[current_index][neighbor_index] = 0;
                        adj_matrix[neighbor_index][current_index] = 0;
                    }
                }
            });
        }
    }
}

function remove_unreachable_nodes(start) {
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const current_index = row * COLS + col;
            if ((row !== start[0] || col !== start[1]) && !bfs_check([row, col], start)) {
                get_neighbors([row, col]).forEach(neighbor => {
                    if (is_valid_matrix_index(neighbor)) {
                        const neighbor_index = neighbor[0] * COLS + neighbor[1];
                        adj_matrix[current_index][neighbor_index] = 0;
                        adj_matrix[neighbor_index][current_index] = 0;
                    }
                });
                maze[row][col] = 0;
            }
        }
    }
}

function bfs_check(start, goal) {
    const q = [];
    q.push(start);
    const visited = new Set();
    visited.add(start.toString());

    while (q.length > 0) {
        const current = q.shift();
        if (current[0] === goal[0] && current[1] === goal[1]) return true;

        get_neighbors(current).forEach(neighbor => {
            if (is_valid(maze, neighbor) && !visited.has(neighbor.toString())) {
                visited.add(neighbor.toString());
                q.push(neighbor);
            }
        });
    }
    return false;
}

function bfs(start, goal) {
    return bfs_direction(start, goal) && bfs_direction(goal, start);
}

function bfs_direction(start, goal) {
    const q = [];
    q.push(start);
    const visited = new Set();
    visited.add(start.toString());

    while (q.length > 0) {
        const current = q.shift();
        if (current[0] === goal[0] && current[1] === goal[1]) return true;

        get_neighbors(current).forEach(neighbor => {
            if (is_valid(maze, neighbor) && !visited.has(neighbor.toString())) {
                visited.add(neighbor.toString());
                q.push(neighbor);
            }
        });
    }
    return false;
}

function is_valid(maze, pos) {
    return 0 <= pos[0] && pos[0] < ROWS && 0 <= pos[1] && pos[1] < COLS && [1, 2, 3].includes(maze[pos[0]][pos[1]]);
}

function log_event(event_type, event_desc) {
    log_data.push({ event_type, event_desc, timestamp: Date.now() });
}

export { generate_maze, log_data, COLORS, GRID_SIZE, ROWS, COLS, player_pos, goal_pos, rect_left, rotation_angle, goal_rect_left, goal_rotation_angle, swap_positions, rotate_positions, goal_picture_position, current_picture_position, visibility_radius, maze, log_event, get_neighbors, is_valid_matrix_index, adj_matrix };
