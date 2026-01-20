import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export default function PopoutWindow({ children, title }) {
  useEffect(() => {
    const newWindow = window.open('', title, 'width=600,height=400');
    newWindow.document.title = title;
    newWindow.document.body.innerHTML = '<div id="popout-root"></div>';
    newWindow.document.body.style.margin = '0';
    newWindow.document.body.style.fontFamily = 'Arial, sans-serif';
    const container = newWindow.document.getElementById('popout-root');

    newWindow.ReactRoot = container;
    container.appendChild(children);
    return () => newWindow.close();
  }, [children, title]);

  return null;
}
