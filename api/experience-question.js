import { handleExperienceQuestionRequest } from './experience-summary.js';

export default async function handler(req, res){
  return handleExperienceQuestionRequest(req, res);
}
