(function(){
const activityCatalog=[
{id:"reading",sub:["book","periodical","article","studyText"],fields:[{id:"material",type:"text"},{id:"pages",type:"number"}]},
{id:"writing",sub:["essay","journal","correspondence","creative","exercises"],fields:[{id:"words",type:"number"}]},
{id:"listening",sub:["audiobook","podcast","music","studyAudio"],fields:[{id:"titleEpisode",type:"text"}]},
{id:"watching",sub:["film","series","cartoon","educationalVideo","shorts"],fields:[{id:"material",type:"text"}]},
{id:"speaking",sub:["monologue","dialogue","realCommunication","mediation"],fields:[{id:"topic",type:"text"}]},
{id:"vocabulary",sub:[],fields:[{id:"newWords",type:"number"},{id:"newPhrases",type:"number"},{id:"topic",type:"text"}]},
{id:"grammar",sub:[],fields:[{id:"grammarTopic",type:"text"},{id:"exercisesCount",type:"number"}]},
{id:"integrated-learning",sub:["textbook","course","app","tutor"],fields:[{id:"lesson",type:"text"}],subFields:{tutor:[{id:"tutorName",type:"text"},{id:"lessonTopic",type:"text"},{id:"practisedSkills",type:"multi",options:["speaking","grammar","vocabulary","listening","reading","writing","pronunciation","mediation"]}]}},
{id:"other",sub:[],fields:[{id:"description",type:"text"}]}
];
window.PolyglowActivities={activityCatalog};
})();
