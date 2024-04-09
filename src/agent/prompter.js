import { readFileSync, mkdirSync, writeFileSync} from 'fs';
import { Gemini } from '../models/gemini.js';
import { GPT } from '../models/gpt.js';
import { Examples } from '../utils/examples.js';
import { getCommandDocs } from './commands/index.js';
import { getSkillDocs } from './library/index.js';
import { stringifyTurns } from '../utils/text.js';
import { getCommand } from './commands/index.js';


export class Prompter {
    constructor(agent, fp) {
        this.prompts = JSON.parse(readFileSync(fp, 'utf8'));
        let name = this.prompts.name;
        this.agent = agent;
        let model_name = this.prompts.model;
        mkdirSync(`./bots/${name}`, { recursive: true });
        writeFileSync(`./bots/${name}/last_profile.json`, JSON.stringify(this.prompts, null, 4), (err) => {
            if (err) {
                throw err;
            }
            console.log("Copy profile saved.");
        });

        if (model_name.includes('gemini'))
            this.model = new Gemini(model_name);
        else if (model_name.includes('gpt'))
            this.model = new GPT(model_name);
        else
            throw new Error('Unknown model ' + model_name);
    }

    getName() {
        return this.prompts.name;
    }

    async initExamples() {
        console.log('Loading examples...')
        this.convo_examples = new Examples(this.model);
        await this.convo_examples.load(this.prompts.conversation_examples);
        this.coding_examples = new Examples(this.model);
        await this.coding_examples.load(this.prompts.coding_examples);
        console.log('Examples loaded.');
    }

    async replaceStrings(prompt, messages, examples=null, prev_memory=null, to_summarize=[]) {
        prompt = prompt.replaceAll('$NAME', this.agent.name);

        if (prompt.includes('$STATS')) {
            let stats = await getCommand('!stats').perform(this.agent);
            prompt = prompt.replaceAll('$STATS', stats);
        }
        if (prompt.includes('$COMMAND_DOCS'))
            prompt = prompt.replaceAll('$COMMAND_DOCS', getCommandDocs());
        if (prompt.includes('$CODE_DOCS'))
            prompt = prompt.replaceAll('$CODE_DOCS', getSkillDocs());
        if (prompt.includes('$EXAMPLES') && examples !== null)
            prompt = prompt.replaceAll('$EXAMPLES', await examples.createExampleMessage(messages));
        if (prompt.includes('$MEMORY'))
            prompt = prompt.replaceAll('$MEMORY', prev_memory ? prev_memory : 'None.');
        if (prompt.includes('$TO_SUMMARIZE'))
            prompt = prompt.replaceAll('$TO_SUMMARIZE', stringifyTurns(to_summarize));

        // check if there are any remaining placeholders with syntax $<word>
        let remaining = prompt.match(/\$[A-Z_]+/g);
        if (remaining !== null) {
            console.warn('Unknown prompt placeholders:', remaining);
        }
        return prompt;
    }

    async promptConvo(messages) {
        let prompt = this.prompts.conversing;
        prompt = await this.replaceStrings(prompt, messages, this.convo_examples);
        return await this.model.sendRequest(messages, prompt);
    }

    async promptCoding(messages) {
        let prompt = this.prompts.coding;
        prompt = await this.replaceStrings(prompt, messages, this.coding_examples);
        return await this.model.sendRequest(messages, prompt);
    }

    async promptMemSaving(prev_mem, to_summarize) {
        let prompt = this.prompts.saving_memory;
        prompt = await this.replaceStrings(prompt, null, null, prev_mem, to_summarize);
        return await this.model.sendRequest([], prompt);
    }

    async promptGoal(messages, prev_goal, prev_success, prev_was_item, buildings) {
        let prompt = this.prompts.goal_select;
        prompt = prompt.replaceAll('$NAME', this.agent.name);
        if (prompt.includes('$GOAL_TYPE') && prev_was_item !== null)
            prompt = prompt.replaceAll('$GOAL_TYPE', prev_was_item ? 'obtaining a' : 'building a');
        if (prompt.includes('$GOAL'))
            prompt = prompt.replaceAll('$GOAL', prev_goal ? prev_goal : 'NONE');
        if (prompt.includes('$SUCCESS'))
            prompt = prompt.replaceAll('$SUCCESS', prev_success ? 'have' : 'have not');
        if (prompt.includes('$BUILDINGS')) {
            let buildings_str = '';
            for (let building of buildings) {
                buildings_str += building + ', ';
            }
            buildings_str = buildings_str.slice(0, -2);
            prompt = prompt.replaceAll('$BUILDINGS', buildings_str);
        }
        if (prompt.includes('$HISTORY')) {
            let history_str = '';
            for (let message of messages) {
                history_str += message.source + ': ' + message.content + '\n';
            }
            history_str = history_str.trim();
            prompt = prompt.replaceAll('$HISTORY', history_str);
        }
        return await this.model.sendRequest([{'role': 'user', 'content': 'Output your next goal.'}], prompt);
    }
}