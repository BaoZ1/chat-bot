/** @jsxImportSource @emotion/react */

import { css } from "@emotion/react";
import { Button } from "antd";
import { SettingOutlined, MessageOutlined } from "@ant-design/icons";

import ChatArea from "./ChatArea"


function App() {

  return (
    <div css={css`
      position: relative;
      height: 100%;
    `}>
      <aside css={css`
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: min-content;
        margin: 10px;
        border: 1px solid rgb(200, 200, 200);
        border-radius: 9999px;
        box-shadow: 3px 3px 5px rgba(200,200,200,0.5);

        & > *:not(:first-of-type) {
          margin-top: 5px;
        }
      `}>
        <Button icon={<MessageOutlined />} type="text" shape="circle" size="large" />
        <Button icon={<SettingOutlined />} type="text" shape="circle" size="large" />
      </aside>
      <div css={css`
        padding: 10px 80px 30px;
        height: 100%;
      `}>
        <ChatArea />
      </div>
    </div>
  );
}

export default App;
