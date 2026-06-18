export { spawnTerminal, writeToTerminal, killTerminal, resizeTerminal } from './terminal.service';
export { listSessions } from './session.service';
export { getCommandHistory, searchCommandHistory, parseCommand, recordExitCode, deleteCommandHistoryEntry, clearCommandHistory } from './command.service';
export { listProfiles, saveProfile, deleteProfile } from './profile.service';
export { listConnections, saveConnection, deleteConnection } from './connection.service';
export { listNotes, getNote, createNote, updateNote, deleteNote, togglePinNote, searchNotes, linkCommandToNote, unlinkCommandNote, getLinkedCommands, getLinkedNotes, listNoteGroups, createNoteGroup, updateNoteGroup, deleteNoteGroup, listNoteCategories, listNoteCategoriesByGroup, createNoteCategory, updateNoteCategory, deleteNoteCategory } from './notebook.service';
export { listProviders, saveProvider, deleteProvider, listModels, saveModel, deleteModel, listAgents, saveAgent, deleteAgent, listConversations, createConversation, deleteConversation, listMessages, saveMessage } from './agent.service';
export { getEnvironment } from './environment.service';
export { checkProStatus, purchaseProLifetime, restoreProLicense, resetLicense, extendTrial, getProProductId } from './licensing.service';
