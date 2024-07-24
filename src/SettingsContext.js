import React, { createContext, useState } from 'react';

export const SettingsContext = createContext();

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState({
    visibilityRadius: 63,
    WIDTH: 500,
    HEIGHT: 700,
    GRID_SIZE: Math.min(500, 700 - 100) / 7,
    ROWS: 7,
    COLS: 7,
    CIRCLE_RADIUS: Math.min(500, 700 - 100) / 7 / 4,
    TOTAL_TRIALS: 10,
    hideEdges: false,
    showAllNodes: false,
    edgesOnTopOfNodes: false,
    edgeWidth: 20,
    nodeAndEdges: true,
    wallColor: ['cyan', 'black', 'black', 'black'],
    borderWidth: 5,
    nodeSize: Math.min(500, 700 - 100) / 7 / 4,
    showGoal: true,
    showOperations: true,
    showStart: true,
    showCurrentPicture: true,
    showGoalPicture: true,
    visibilityRadiusNode: 0.25,
    visibilityRadiusPicture: 0.5,
    connectivitySparsity: 0.2,
    mazeSeed: "Maze",
    operationNodeSeed: null,
    mazeStructure: null,
  });

  const updateSettings = (newSettings) => {
    setSettings((prevSettings) => {
      const updatedSettings = { ...prevSettings, ...newSettings };
      updatedSettings.GRID_SIZE = Math.min(updatedSettings.WIDTH, updatedSettings.HEIGHT - 100) / updatedSettings.ROWS;
      updatedSettings.CIRCLE_RADIUS = updatedSettings.GRID_SIZE / 4;
      return updatedSettings;
    });
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};
