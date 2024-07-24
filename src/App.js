import React from 'react';
import MazeGame from './MazeGame';
import { SettingsProvider } from './SettingsContext';
const App = () => {
  return (
    <div>
      <SettingsProvider>
        <MazeGame />
      </SettingsProvider>
    </div>
  );
};

export default App;
