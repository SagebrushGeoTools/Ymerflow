import React, { useContext } from 'react';
import { Routes, Route, useParams } from 'react-router-dom';
import { LayoutProvider } from './flexout/LayoutContext';
import { MainLayout, PopoutWrapper } from './flexout/Layout';


export default function App() {
  return (
    <LayoutProvider>
      <Routes>
        <Route path="/" element={<MainLayout />} />
        <Route path="/popout/:id" element={<PopoutWrapper />} />
      </Routes>
    </LayoutProvider>
  );
}
