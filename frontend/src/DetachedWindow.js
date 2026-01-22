import { useEffect } from "react";
import ReactDOM from "react-dom";

export default function DetachedWindow({ children, title }) {
  const win = window.open("", "", "width=800,height=600");

  useEffect(() => {
    win.document.title = title;
    return () => win.close();
  }, []);

  return ReactDOM.createPortal(children, win.document.body);
}
