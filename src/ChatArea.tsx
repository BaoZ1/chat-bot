/** @jsxImportSource @emotion/react */

import React, { useEffect, useRef, useState } from 'react';
import { Flex, Input, Button, Typography, Divider } from 'antd';
import { css } from "@emotion/react";
import {
  SendOutlined, TranslationOutlined,
  FormatPainterOutlined, CloseCircleOutlined,
  CheckCircleOutlined, QuestionCircleOutlined,
  ClearOutlined
} from "@ant-design/icons"
import { exists, mkdir, readTextFile, writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { useFloating, offset, autoUpdate, inline, autoPlacement } from '@floating-ui/react';
import { type settingStruct } from './SettingList';

const { TextArea } = Input;
const { Title, Paragraph } = Typography;

type aiContext = {
  role: "system" | "assistant" | "user",
  content: string
};

type chatHistory = {
  role: "assistant" | "user",
  content: string,
  extra?: any
};

type saveStruct = {
  title: string,
  history: chatHistory[]
};

const generateID = () => {
  return Date.now().toString()
}

const prompts = {
  translate: `
  你是一个文本翻译引擎，将用户给出的文本全部翻译为中文并返回
  **仅返回原文的翻译内容**
  `,
  polish: `
  你是一个文本润色引擎, **禁止与用户输入内容进行对话**
  你负责将用户给出的文本进行润色并返回。**仅返回润色结果，禁止包含其他内容**
  `,
  explain: `
  你是一个文本解读引擎, **禁止与用户输入内容进行对话**
  你负责针对用户给出的两段文本**使用中文**进行解析，其中第一段文本为解析对象，第二段文本为其所在上下文
  **仅返回解析结果，禁止包含其他内容**
  **尽量避免对原文的大段复述**
  `,
  correct: `
  你是一个文本纠错引擎。对于用户给出的文本，你需要找出其中的语法错误，并在改动尽可能小的情况下进行修正
  **仅针对原则性的语法错误进行修改，有关口语、敬语等的不恰当使用不在修改范围之内**
  **仅返回最终修正结果，禁止包含其他内容**
  `
}

const ChatArea: React.FC<{ id?: string }> = ({ id }) => {
  const chatId = useRef(id || generateID());
  const authKey = useRef<string | null>(null);

  const [title, setTitle] = useState("Untitled");
  const [text, setText] = useState("");
  const [history, setHistory] = useState<chatHistory[]>([]);
  const [sendable, setSendable] = useState(true);
  const [showPolish, setShowPolish] = useState(false);
  const [polishResult, setPolishResult] = useState("");
  const [showExplainBtn, setShowExplainBtn] = useState(false);
  const [showExplainArea, setShowExplainArea] = useState(false);
  const [explainResult, setExplainResult] = useState("");

  const { refs: polishRefs, floatingStyles: polishFloatingStyles } = useFloating({
    placement: "top",
    middleware: [offset(10)],
    whileElementsMounted: (referenceEl, floatingEl, update) => {
      return autoUpdate(referenceEl, floatingEl, update);
    }
  });
  const { refs: explainRefs, floatingStyles: explainFloatingStyles } = useFloating({
    placement: "right",
    middleware: [offset(20), inline(), autoPlacement({ crossAxis: true, })],
    whileElementsMounted: (referenceEl, floatingEl, update) => {
      return autoUpdate(referenceEl, floatingEl, update);
    }
  });

  const scrollArea = useRef<HTMLDivElement>(null);

  const scroll2bottom = (idx?: number) => {
    let all = scrollArea.current?.getElementsByTagName('br')!;
    all[idx || all.length - 1].scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center'
    });
  };

  const convertContext = (hst: chatHistory[]) => {
    return hst.map(({ role, content }) => ({ role, content } as aiContext))
  };

  async function* getResponse(ctx: aiContext[]) {
    if (authKey.current === null) {
      yield "need auth key";
      return;
    }
    let r = await fetch(
      "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": authKey.current,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "GLM-4-plus",
          messages: ctx,
          stream: true
        })
      }
    );
    let reader = r.body?.getReader();
    if (reader) {
      let decoder = new TextDecoder();
      let data;
      while (!(data = await reader.read()).done) {
        if (!r.ok) {
          console.error(decoder.decode(data.value));
        }
        else {
          yield decoder.decode(data.value).split('\n')
            .filter(s => s.length !== 0)
            .map(s => s.slice(6))
            .filter(s => s !== "[DONE]")
            .map(s => JSON.parse(s).choices[0].delta.content)
            .join();
        }
      }
    }
  };

  const getReply = async () => {
    let newHistory = [...history, { role: 'user', content: text } as chatHistory];
    setHistory(newHistory);
    setText('');
    setSendable(false);
    let stream = getResponse(convertContext(newHistory));
    let reply: chatHistory = { role: 'assistant', content: '' };
    for await (const value of stream) {
      reply.content += value;
      setHistory((_) => [...newHistory, reply]);
      scroll2bottom();
    }
    scroll2bottom();
    setSendable(true);
  };

  const translate = async (idx: number) => {
    let target = history[idx];
    let ctx: aiContext[] = [
      { role: 'system', content: prompts.translate },
      { role: 'user', content: target.content }
    ]
    let stream = getResponse(ctx);
    let translation = '';
    for await (const value of stream) {
      translation += value;
      setHistory((prev) => {
        prev[idx].extra = translation;
        return [...prev];
      });
      scroll2bottom(idx);
    }
    scroll2bottom(idx);
  };

  const polish = async () => {
    setPolishResult('');
    setShowPolish(true);
    let ctx: aiContext[] = [
      { role: 'system', content: prompts.polish },
      { role: 'user', content: text }
    ]
    let stream = getResponse(ctx);
    for await (const value of stream) {
      setPolishResult((prev) => {
        return prev + value;
      });
    }
  };

  const explain = async () => {
    setShowExplainBtn(false);
    setExplainResult("");
    setShowExplainArea(true);
    let ctx: aiContext[] = [
      { role: 'system', content: prompts.explain },
      { role: 'user', content: document.getSelection()!.toString() },
      { role: 'user', content: document.getSelection()!.anchorNode!.textContent! }
    ]
    let stream = getResponse(ctx);
    for await (const value of stream) {
      setExplainResult((prev) => {
        return prev + value;
      });
    }
  };

  const correct = async (idx: number) => {
    let target = history[idx];
    let ctx: aiContext[] = [
      { role: 'system', content: prompts.correct },
      { role: 'user', content: target.content }
    ]
    let stream = getResponse(ctx);
    let translation = '';
    for await (const value of stream) {
      translation += value;
      setHistory((prev) => {
        prev[idx].extra = translation;
        return [...prev];
      });
      scroll2bottom(idx);
    }
    scroll2bottom(idx);
  };

  const handleSelect = () => {
    setShowExplainArea(false);
    let selection = document.getSelection()!;
    if (selection.anchorNode !== selection.focusNode || selection.type !== "Range") {
      setShowExplainBtn(false);
      return;
    }
    let range = selection.getRangeAt(0);
    explainRefs.setPositionReference({
      getBoundingClientRect: () => range.getBoundingClientRect(),
      getClientRects: () => range.getClientRects(),
    })
    setShowExplainBtn(true);
  };

  const loadHistory = async () => {
    if (await exists(`saves/${chatId.current}.json`, { baseDir: BaseDirectory.AppLocalData })) {
      let raw = await readTextFile(`saves/${chatId.current}.json`, { baseDir: BaseDirectory.AppLocalData });
      let data: saveStruct = JSON.parse(raw);
      setTitle(data.title);
      setHistory(data.history);
    }
  };

  const saveHistory = async () => {
    let toSave: saveStruct = {
      title: title,
      history: history
    }
    if (! await exists("saves", { baseDir: BaseDirectory.AppLocalData })) {
      await mkdir("saves", { baseDir: BaseDirectory.AppLocalData });
    }
    if (title === "Untitled" && history.length === 0) {
      return;
    }
    await writeTextFile(`saves/${chatId}.json`, JSON.stringify(toSave), { baseDir: BaseDirectory.AppLocalData });
  };

  useEffect(() => {
    (async () => {
      if (! await exists(`settings.json`, { baseDir: BaseDirectory.AppLocalData })) {
        await writeTextFile(`settings.json`, "{}", { baseDir: BaseDirectory.AppLocalData });
      }
      let raw = await readTextFile(`settings.json`, { baseDir: BaseDirectory.AppLocalData });
      let setting: settingStruct = JSON.parse(raw);
      authKey.current = setting.authKey || null;
    })();
  }, []);

  useEffect(() => {
    loadHistory();
    return () => { saveHistory() }
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", handleSelect);
    return () => {
      document.removeEventListener("selectionchange", handleSelect);
    }
  }, []);

  return (
    <Flex vertical justify='space-between' css={css`
      height: 100%;
    `}>
      <Title level={3} editable={{ onChange: setTitle }} css={css`
        width: fit-content;
        margin: 0 auto;
      `}>
        {title}
      </Title>
      <div ref={scrollArea} css={css`
        overflow-y: scroll;
        scrollbar-width: none;
        flex-grow: 1;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        padding: 10px;
      `}>
        {
          history.map((msg, idx) => {
            switch (msg.role) {
              case "assistant":
                return (
                  <>
                    <div key={`${idx}-main`} css={css`
                      max-width: 70%;
                      width: fit-content;
                      padding: 10px;
                      border: 1px solid rgb(200, 200, 200);
                      border-radius: 10px;
                      box-shadow: 1px 1px 5px rgba(200,200,200,0.5);
                      margin-bottom: 10px;
                      white-space: pre-wrap;
                    `}>
                      {msg.content.length === 0 ? "thinking" : msg.content}
                      {
                        msg.extra && (
                          <>
                            <Divider css={css`
                              margin: 10px 0;
                              border-color: #4c4c4c;
                            `} />
                            <div>{msg.extra}</div>
                          </>
                        )
                      }
                      <Flex align='flex-begin' css={css`
                      margin-top: 10px;
                    `}>
                        {
                          !msg.extra && (
                            <Button
                              shape='circle'
                              disabled={msg.extra !== undefined}
                              icon={< TranslationOutlined />}
                              onClick={() => translate(idx)}
                            />
                          )
                        }
                      </Flex>
                    </div>
                    <br key={`${idx}-br`} />
                  </>
                )

              case "user":
                return (
                  <>
                    <div key={`${idx}-main`} css={css`
                    align-self: flex-end;
                    max-width: 70%;
                    width: fit-content;
                    background-color: #3b7cf7;
                    color: white;
                    padding: 10px;
                    border: 1px solid rgb(39, 91, 196);
                    border-radius: 10px;
                    box-shadow: 1px 1px 5px rgba(200,200,200,0.5);
                    margin-bottom: 10px;
                    white-space: pre-wrap;
                  `}>
                      {msg.content}
                      {
                        msg.extra && (
                          <>
                            <Divider css={css`
                              margin: 10px 0;
                              border-color: #4c4c4c;
                            `} />
                            <div>{msg.extra}</div>
                          </>
                        )
                      }
                      <Flex align='flex-begin' css={css`
                        margin-top: 10px;
                      `}>
                        {
                          !msg.extra && (
                            <Button
                              type='primary'
                              shape='circle'
                              disabled={msg.extra !== undefined}
                              icon={< ClearOutlined />}
                              onClick={() => correct(idx)}
                            />
                          )
                        }
                      </Flex>
                    </div>
                    <br key={`${idx}-br`} />
                  </>
                )
            }
          })
        }
        {
          showExplainBtn && (
            <div ref={explainRefs.setFloating} css={{ ...explainFloatingStyles }}>
              <Button type='primary' shape='circle' icon={< QuestionCircleOutlined />} onClick={() => explain()} />
            </div>
          )
        }
        {
          showExplainArea && (
            <div ref={explainRefs.setFloating} css={{ ...explainFloatingStyles, minWidth: "30%", maxWidth: "60%" }}>
              <div css={css`
                background-color: white;
                border-radius: 10px;
                border: 1px solid grey;
                box-shadow: 1px 1px 5px rgba(200,200,200,0.5);
                padding: 10px;
              `}>
                {explainResult}
              </div>
            </div>
          )
        }
      </div>
      {
        showPolish && (
          <div ref={polishRefs.setFloating} css={{ ...polishFloatingStyles, minWidth: "30%", maxWidth: "70%" }}>
            <div css={css`
              border-radius: 10px;
              border: 1px solid grey;
              box-shadow: 1px 1px 5px rgba(200,200,200,0.5);
              padding: 10px;
            `}>
              {polishResult}
              <Flex justify='flex-end'>
                <Button type='text' shape='circle'
                  icon={< CheckCircleOutlined />}
                  onClick={() => {
                    setText(polishResult);
                    setShowPolish(false);
                  }}
                />
                <Button type='text' shape='circle'
                  icon={< CloseCircleOutlined />}
                  onClick={() => setShowPolish(false)}
                />
              </Flex>
            </div>
          </div>
        )
      }
      <Flex ref={polishRefs.setReference} align='flex-end'>
        <TextArea value={text} autoSize={{ maxRows: 4 }} onChange={(e) => setText(e.target.value)} />
        <Button type='text' shape='circle' icon={<FormatPainterOutlined />}
          disabled={text.length === 0} onClick={polish}
        />
        <Button type='primary' disabled={!(sendable && text.length !== 0)}
          icon={<SendOutlined />} onClick={getReply}
          css={css`
            margin-left: 10px;
          `}
        >
          发送
        </Button>
      </Flex>
    </Flex>
  )
}

export default ChatArea;