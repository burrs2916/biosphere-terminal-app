import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import commonZh from '../locales/zh-CN/common.json';
import terminalZh from '../locales/zh-CN/terminal.json';
import notebookZh from '../locales/zh-CN/notebook.json';
import agentZh from '../locales/zh-CN/agent.json';
import commandZh from '../locales/zh-CN/command.json';
import remoteDesktopZh from '../locales/zh-CN/remoteDesktop.json';
import backendZh from '../locales/zh-CN/backend.json';

import commonEn from '../locales/en-US/common.json';
import terminalEn from '../locales/en-US/terminal.json';
import notebookEn from '../locales/en-US/notebook.json';
import agentEn from '../locales/en-US/agent.json';
import commandEn from '../locales/en-US/command.json';
import remoteDesktopEn from '../locales/en-US/remoteDesktop.json';
import backendEn from '../locales/en-US/backend.json';

const resources = {
  'zh-CN': {
    common: commonZh,
    terminal: terminalZh,
    notebook: notebookZh,
    agent: agentZh,
    command: commandZh,
    remoteDesktop: remoteDesktopZh,
    backend: backendZh,
  },
  'en-US': {
    common: commonEn,
    terminal: terminalEn,
    notebook: notebookEn,
    agent: agentEn,
    command: commandEn,
    remoteDesktop: remoteDesktopEn,
    backend: backendEn,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'zh-CN',
    defaultNS: 'common',
    ns: ['common', 'terminal', 'notebook', 'agent', 'command', 'remoteDesktop', 'backend'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'biosphere-locale',
    },
  });

export default i18n;
