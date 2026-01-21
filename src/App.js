import React, { useContext } from 'react';
import { Routes, Route, useParams } from 'react-router-dom';
import { LayoutProvider } from './flexout/LayoutContext';
import { MainLayout, PopoutWrapper } from './flexout/Layout';


export default function App() {
  var widgets = {
    ClockWidget: () => <div>🕒 A simple clock</div>,
    SampleWidget: () => <div>📦 Just a package for you</div>,
    NotesWidget: () => <div>📝 Some notes</div>,
  };
  
  return (
    <LayoutProvider widgets={widgets}>
      <Routes>
        <Route path="/" element={<MainLayout />} />
        <Route path="/popout/:id" element={<PopoutWrapper />} />
      </Routes>
    </LayoutProvider>
  );
}
